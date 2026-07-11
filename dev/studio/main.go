// Creative Studio — local server for generating images & video via OpenRouter.
//
// All generated files are saved to a single directory (default: ai_outputs/
// at the project root). The user is responsible for moving/organizing them
// afterwards.
//
// Endpoints:
//
//	GET  /              — serves the HTML form (static/index.html, embedded)
//	GET  /app.js        — serves the JS bundle (static/app.js, embedded)
//	GET  /api/models    — returns { image: [...], video: [...] } of available models
//	POST /api/generate  — accepts multipart form, dispatches gen, returns { kind, url, path }
//	GET  /api/output/   — serves files from the ai_outputs/ directory
//
// API key: read from OPENROUTER_API_KEY env var.
// Output dir: AI_OUTPUTS_DIR env var, or "<projectRoot>/ai_outputs" by default.
//
// Build: go build -o studio.exe
// Run:   studio.exe  (or double-click start-studio.bat)
package main

import (
	"context"
	"embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	openrouter "github.com/OpenRouterTeam/go-sdk"
	"github.com/OpenRouterTeam/go-sdk/models/components"
	"github.com/OpenRouterTeam/go-sdk/models/operations"
)

//go:embed static
var staticFS embed.FS

const (
	defaultPort     = "7878"
	videoPollEvery  = 5 * time.Second
	videoTimeoutMax = 10 * time.Minute
	defaultOutDir   = "ai_outputs"

	// maxReferenceImages is the hard cap on the number of reference images
	// the user may upload for image-to-image / image-to-video. Enforced both
	// client-side (UI rejects >16 picks) and server-side (HTTP 400 if violated).
	maxReferenceImages = 16
)

// Cached at startup so we don't refetch the model list on every page load.
type modelLists struct {
	Image []modelEntry `json:"image"`
	Video []modelEntry `json:"video"`
}

type modelEntry struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func main() {
	port := os.Getenv("STUDIO_PORT")
	if port == "" {
		port = defaultPort
	}

	apiKey := os.Getenv("OPENROUTER_API_KEY")
	if apiKey == "" {
		fmt.Fprintln(os.Stderr, "ERROR: OPENROUTER_API_KEY is not set.")
		fmt.Fprintln(os.Stderr, "Set it in your environment, or edit start-studio.bat.")
		os.Exit(1)
	}

	client := openrouter.New(openrouter.WithSecurity(apiKey))

	// Resolve the output directory. Priority:
	//   1. $AI_OUTPUTS_DIR (absolute or relative to CWD)
	//   2. <repoRoot>/ai_outputs  (created on first run)
	outputDir := resolveOutputDir()
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: cannot create output dir %s: %v\n", outputDir, err)
		os.Exit(1)
	}

	// Pre-warm model list (best-effort). If it fails, the UI still works and
	// will show a "no models available" message.
	models := loadModels(context.Background(), client)

	mux := http.NewServeMux()

	// Static UI
	sub, _ := fs.Sub(staticFS, "static")
	mux.Handle("GET /", http.FileServer(http.FS(sub)))

	// API
	mux.HandleFunc("GET /api/models", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, models)
	})
	mux.HandleFunc("POST /api/generate", func(w http.ResponseWriter, r *http.Request) {
		handleGenerate(w, r, client, outputDir)
	})

	// Serve generated outputs. This is how the browser shows the <img>/<video>
	// preview after generation.
	mux.Handle("GET /api/output/", http.StripPrefix("/api/output/", http.FileServer(http.Dir(outputDir))))

	addr := ":" + port
	fmt.Printf("Creative Studio listening on http://localhost%s\n", addr)
	fmt.Printf("  output dir:  %s\n", outputDir)
	fmt.Printf("  Press Ctrl+C to stop.\n")
	if err := http.ListenAndServe(addr, mux); err != nil {
		fmt.Fprintln(os.Stderr, "server error:", err)
		os.Exit(1)
	}
}

// ----- helpers -----

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		fmt.Fprintln(os.Stderr, "encode error:", err)
	}
}

// resolveOutputDir determines where generated files are written.
// Priority: $AI_OUTPUTS_DIR (if set, used as-is, relative paths are CWD-relative),
// otherwise <repoRoot>/ai_outputs/ where repoRoot is the first ancestor of
// CWD that contains a "dev" directory (i.e. the workspace root).
func resolveOutputDir() string {
	if env := strings.TrimSpace(os.Getenv("AI_OUTPUTS_DIR")); env != "" {
		return filepath.Clean(env)
	}
	cwd, _ := os.Getwd()
	dir := cwd
	for i := 0; i < 6; i++ {
		if _, err := os.Stat(filepath.Join(dir, "dev")); err == nil {
			return filepath.Join(dir, defaultOutDir)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	// Fall back to CWD if we can't find a repo root.
	return filepath.Join(cwd, defaultOutDir)
}

// loadModels returns a curated list of image and video models. The full OpenRouter
// catalog is huge; we expose the most useful ones for creative generation.
func loadModels(ctx context.Context, client *openrouter.OpenRouter) modelLists {
	imageModels := []modelEntry{
		{ID: "x-ai/grok-imagine-image-quality", Name: "Grok Imagine (Image) — quality"},
	}
	videoModels := []modelEntry{
		{ID: "bytedance/seedance-2.0", Name: "Seedance 2.0 — video"},
		{ID: "x-ai/grok-imagine-video", Name: "Grok Imagine — video"},
		{ID: "google/veo-3.1-lite", Name: "Veo 3.1 Lite — video"},
	}

	// Best-effort: confirm the API key works. We don't currently rewrite the
	// curated list with the live one because the full list is hundreds of
	// entries and most aren't relevant.
	if resp, err := client.Models.List(ctx, nil); err == nil && resp != nil {
		_ = resp
	} else if err != nil {
		fmt.Fprintln(os.Stderr, "warning: could not verify API key via /models:", err)
	}

	return modelLists{Image: imageModels, Video: videoModels}
}

// ----- generation -----

func handleGenerate(w http.ResponseWriter, r *http.Request, client *openrouter.OpenRouter, outputDir string) {
	// Limit upload size to 50 MB (cumulative). Reference images are usually small.
	if err := r.ParseMultipartForm(50 << 20); err != nil {
		http.Error(w, "invalid form: "+err.Error(), http.StatusBadRequest)
		return
	}

	genType := r.FormValue("type") // "image" or "video"
	prompt := strings.TrimSpace(r.FormValue("prompt"))
	modelID := r.FormValue("model")

	if prompt == "" {
		http.Error(w, "prompt is required", http.StatusBadRequest)
		return
	}
	if modelID == "" {
		http.Error(w, "model is required", http.StatusBadRequest)
		return
	}

	// Collect optional generation params. Empty values are sent through as
	// empty strings/zero ints/false bools; each generate* function omits the
	// field from the SDK request if the value is "blank" (see applyGenParams).
	params := readGenParams(r)

	// Read uploaded reference images (if any). We read them fully so the
	// request body can be released before the (potentially long) generation.
	var refImages []refImage
	if files := r.MultipartForm.File["ref"]; len(files) > 0 {
		if len(files) > maxReferenceImages {
			http.Error(w, fmt.Sprintf("too many reference images: %d (max %d)", len(files), maxReferenceImages), http.StatusBadRequest)
			return
		}
		for _, fh := range files {
			img, err := readRefImage(fh)
			if err != nil {
				http.Error(w, fmt.Sprintf("invalid reference image %q: %v", fh.Filename, err), http.StatusBadRequest)
				return
			}
			refImages = append(refImages, img)
		}
	}

	// Validate type
	switch genType {
	case "image", "video":
		// valid
	default:
		http.Error(w, "invalid type: "+genType, http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), videoTimeoutMax+30*time.Second)
	defer cancel()

	switch genType {
	case "image":
		result, err := generateImage(ctx, client, modelID, prompt, refImages, params)
		if err != nil {
			http.Error(w, "image generation failed: "+err.Error(), http.StatusBadGateway)
			return
		}
		fileName, err := saveOutput(outputDir, genType, modelID, result.ext, result.data)
		if err != nil {
			http.Error(w, "save failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]any{
			"kind": "image",
			"path": fileName,
			"url":  "/api/output/" + fileName,
		})
	case "video":
		result, err := generateVideo(ctx, client, modelID, prompt, refImages, params)
		if err != nil {
			http.Error(w, "video generation failed: "+err.Error(), http.StatusBadGateway)
			return
		}
		fileName, err := saveOutput(outputDir, genType, modelID, result.ext, result.data)
		if err != nil {
			http.Error(w, "save failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]any{
			"kind": "video",
			"path": fileName,
			"url":  "/api/output/" + fileName,
		})
	}
}

type refImage struct {
	filename string
	mime     string
	data     []byte
}

func readRefImage(fh *multipart.FileHeader) (refImage, error) {
	f, err := fh.Open()
	if err != nil {
		return refImage{}, err
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		return refImage{}, err
	}
	mime := fh.Header.Get("Content-Type")
	if mime == "" {
		mime = "image/png"
	}
	return refImage{
		filename: fh.Filename,
		mime:     mime,
		data:     data,
	}, nil
}

// dataURL returns a base64 data URL the SDK can consume directly.
// Format: data:<mime>;base64,<bytes>
func (r refImage) dataURL() string {
	return fmt.Sprintf("data:%s;base64,%s", r.mime, base64.StdEncoding.EncodeToString(r.data))
}

// genParams holds all optional generation parameters collected from the form.
// Empty strings / zero values mean "use the provider default" — the SDK has
// `omitzero` on these fields, so a nil pointer results in the JSON key being
// omitted entirely.
type genParams struct {
	// Image
	AspectRatio       string // e.g. "1:1", "16:9", "auto"
	Background        string // "auto", "transparent", "opaque"
	OutputFormat      string // "png", "jpeg", "webp", "svg"
	Quality           string // "auto", "low", "medium", "high"
	Resolution        string // image: "512","1K","2K","4K"  | video: "480p","720p","1080p","1K","2K","4K"
	N                 int    // 1..10
	OutputCompression int    // 0..100 (jpeg/webp only)
	Seed              int

	// Video
	Duration      int // seconds
	GenerateAudio bool
}

// readGenParams pulls every optional field off the multipart form. Missing or
// blank values stay as the zero value of their type.
func readGenParams(r *http.Request) genParams {
	p := genParams{
		AspectRatio:       strings.TrimSpace(r.FormValue("aspect_ratio")),
		Background:        strings.TrimSpace(r.FormValue("background")),
		OutputFormat:      strings.TrimSpace(r.FormValue("output_format")),
		Quality:           strings.TrimSpace(r.FormValue("quality")),
		Resolution:        strings.TrimSpace(r.FormValue("resolution")),
		N:                 atoiOrZero(r.FormValue("n")),
		OutputCompression: atoiOrZero(r.FormValue("output_compression")),
		Seed:              atoiOrZero(r.FormValue("seed")),
		Duration:          atoiOrZero(r.FormValue("duration")),
		GenerateAudio:     r.FormValue("generate_audio") == "on" || r.FormValue("generate_audio") == "true",
	}
	return p
}

func atoiOrZero(s string) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return n
}

// strPtr is a tiny helper for setting optional SDK string fields.
func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
func int64Ptr(n int) *int64 {
	if n == 0 {
		return nil
	}
	v := int64(n)
	return &v
}
func boolPtr(b bool) *bool {
	if !b {
		return nil
	}
	return &b
}

// genResult is the raw output of an image or video generation. ext is the
// file extension to use when saving; data is the raw bytes.
type genResult struct {
	ext  string
	data []byte
}

func generateImage(ctx context.Context, client *openrouter.OpenRouter, modelID, prompt string, refs []refImage, p genParams) (genResult, error) {
	req := components.ImageGenerationRequest{
		Model:  modelID,
		Prompt: prompt,
	}
	if len(refs) > 0 {
		// image-to-image: forward every uploaded reference. The SDK accepts a
		// list, and the cap is enforced in handleGenerate.
		req.InputReferences = make([]components.ContentPartImage, 0, len(refs))
		for _, ref := range refs {
			req.InputReferences = append(req.InputReferences, components.ContentPartImage{
				Type:     components.ContentPartImageTypeImageURL,
				ImageURL: components.ContentPartImageImageURL{URL: ref.dataURL()},
			})
		}
	}

	// Optional params. Each helper returns nil for "blank", which the SDK
	// omits from the request body via `omitzero`.
	if v := p.AspectRatio; v != "" {
		req.AspectRatio = (*components.ImageGenerationRequestAspectRatio)(&v)
	}
	if v := p.Background; v != "" {
		req.Background = (*components.ImageGenerationRequestBackground)(&v)
	}
	if v := p.OutputFormat; v != "" {
		req.OutputFormat = (*components.ImageGenerationRequestOutputFormat)(&v)
	}
	if v := p.Quality; v != "" {
		req.Quality = (*components.ImageGenerationRequestQuality)(&v)
	}
	if v := p.Resolution; v != "" {
		req.Resolution = (*components.ImageGenerationRequestResolution)(&v)
	}
	req.N = int64Ptr(p.N)
	req.OutputCompression = int64Ptr(p.OutputCompression)
	req.Seed = int64Ptr(p.Seed)

	resp, err := client.Images.Generate(ctx, req, operations.WithOperationTimeout(2*time.Minute))
	if err != nil {
		return genResult{}, err
	}
	if resp == nil || resp.ImageGenerationResponse == nil || len(resp.ImageGenerationResponse.Data) == 0 {
		return genResult{}, fmt.Errorf("no image data in response")
	}

	img := resp.ImageGenerationResponse.Data[0]
	bytes, err := base64.StdEncoding.DecodeString(img.B64JSON)
	if err != nil {
		return genResult{}, fmt.Errorf("decode b64_json: %w", err)
	}

	ext := "png"
	if mt := img.GetMediaType(); mt != nil {
		switch *mt {
		case "image/jpeg":
			ext = "jpg"
		case "image/webp":
			ext = "webp"
		case "image/svg+xml":
			ext = "svg"
		}
	}
	return genResult{ext: ext, data: bytes}, nil
}

func generateVideo(ctx context.Context, client *openrouter.OpenRouter, modelID, prompt string, refs []refImage, p genParams) (genResult, error) {
	req := components.VideoGenerationRequest{
		Model:  modelID,
		Prompt: prompt,
	}
	if len(refs) > 0 {
		// image-to-video: forward every uploaded reference as a frame anchor.
		// We mark the first uploaded ref as the first_frame and, if there are
		// at least two, the last one as the last_frame. The cap is enforced
		// in handleGenerate.
		req.FrameImages = make([]components.FrameImage, 0, len(refs))
		for i, ref := range refs {
			ft := components.FrameTypeFirstFrame
			if i == len(refs)-1 && len(refs) >= 2 {
				ft = components.FrameTypeLastFrame
			}
			req.FrameImages = append(req.FrameImages, components.FrameImage{
				Type:      components.FrameImageTypeImageURL,
				ImageURL:  components.FrameImageImageURL{URL: ref.dataURL()},
				FrameType: ft,
			})
		}
	}

	// Optional params. Each helper returns nil for "blank", which the SDK
	// omits from the request body via `omitzero`.
	if v := p.AspectRatio; v != "" {
		req.AspectRatio = (*components.VideoGenerationRequestAspectRatio)(&v)
	}
	if v := p.Resolution; v != "" {
		req.Resolution = (*components.VideoGenerationRequestResolution)(&v)
	}
	req.Duration = int64Ptr(p.Duration)
	req.GenerateAudio = boolPtr(p.GenerateAudio)
	req.Seed = int64Ptr(p.Seed)

	// Submit job
	submit, err := client.VideoGeneration.Generate(ctx, req, operations.WithOperationTimeout(2*time.Minute))
	if err != nil {
		return genResult{}, fmt.Errorf("submit: %w", err)
	}
	if submit == nil {
		return genResult{}, fmt.Errorf("submit returned nil response")
	}

	jobID := submit.GetID()
	if jobID == "" {
		return genResult{}, fmt.Errorf("submit returned empty job id")
	}

	// Poll until done. We log to stderr so the user can watch progress if they
	// have the terminal open.
	fmt.Fprintf(os.Stderr, "video job submitted: %s (status=%s)\n", jobID, submit.GetStatus())
	deadline := time.Now().Add(videoTimeoutMax)
	for {
		if time.Now().After(deadline) {
			return genResult{}, fmt.Errorf("video generation timed out after %s", videoTimeoutMax)
		}
		select {
		case <-ctx.Done():
			return genResult{}, ctx.Err()
		case <-time.After(videoPollEvery):
		}

		status, err := client.VideoGeneration.GetGeneration(ctx, jobID, operations.WithOperationTimeout(30*time.Second))
		if err != nil {
			fmt.Fprintf(os.Stderr, "poll error (will retry): %v\n", err)
			continue
		}
		fmt.Fprintf(os.Stderr, "video job %s: status=%s\n", jobID, status.GetStatus())

		switch status.GetStatus() {
		case components.VideoGenerationResponseStatusCompleted:
			urls := status.GetUnsignedUrls()
			if len(urls) == 0 {
				return genResult{}, fmt.Errorf("completed but no urls in response")
			}
			videoBytes, err := downloadFile(ctx, urls[0])
			if err != nil {
				return genResult{}, fmt.Errorf("download video: %w", err)
			}
			return genResult{ext: "mp4", data: videoBytes}, nil
		case components.VideoGenerationResponseStatusFailed,
			components.VideoGenerationResponseStatusCancelled,
			components.VideoGenerationResponseStatusExpired:
			msg := status.GetError()
			if msg == nil {
				s := string(status.GetStatus())
				msg = &s
			}
			return genResult{}, fmt.Errorf("video job %s: %s", status.GetStatus(), *msg)
		}
		// pending / in_progress -> poll again
	}
}

func downloadFile(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("download %s: HTTP %d", url, resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

// saveOutput writes data to outputDir using a self-describing filename:
//
//	<UTC timestamp>_<kind>_<sanitized-model>.<ext>
//
// e.g. 2026-07-11T143022Z_image_gemini-2.5-flash-image.png
// If a file with that name already exists, append _1, _2, ... to disambiguate.
// Returns the file name (no directory) for use in the response.
func saveOutput(outputDir, genType, modelID, ext string, data []byte) (string, error) {
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return "", fmt.Errorf("mkdir %s: %w", outputDir, err)
	}
	ts := time.Now().UTC().Format("2006-01-02T150405Z")
	kind := "image"
	if genType == "t2v" || genType == "i2v" {
		kind = "video"
	}
	base := fmt.Sprintf("%s_%s_%s.%s", ts, kind, sanitizeForFilename(modelID), ext)
	full := filepath.Join(outputDir, base)
	if _, err := os.Stat(full); err == nil {
		// Timestamp collision (two generations in the same second). Disambiguate.
		for i := 1; i < 1000; i++ {
			candidate := fmt.Sprintf("%s_%s_%s_%d.%s", ts, kind, sanitizeForFilename(modelID), i, ext)
			candFull := filepath.Join(outputDir, candidate)
			if _, err := os.Stat(candFull); os.IsNotExist(err) {
				full = candFull
				break
			}
		}
	}
	if err := os.WriteFile(full, data, 0o644); err != nil {
		return "", err
	}
	return filepath.Base(full), nil
}

// sanitizeForFilename turns a model ID like "black-forest-labs/flux.2-pro" into
// "black-forest-labs-flux.2-pro" so it's safe across filesystems.
func sanitizeForFilename(s string) string {
	r := strings.NewReplacer("/", "-", "\\", "-", ":", "-", " ", "_")
	return r.Replace(s)
}
