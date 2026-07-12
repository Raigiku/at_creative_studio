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
// API key: loaded from the OS credential manager (preferred) or the
// OPENROUTER_API_KEY env var (fallback). Manage it with the platform-
// native scripts in scripts/ — there is NO credential subcommand in this
// binary. See scripts\set-key.bat (Windows) or scripts/set-key.sh
// (macOS/Linux) for details.
//
// Output dir: AI_OUTPUTS_DIR env var, or "<projectRoot>/ai_outputs" by default.
//
// Build: go build -o studio.exe        (Windows)
//
//	go build -o studio            (macOS / Linux)
//
// Run:   studio.exe                     (Windows, or double-click start-studio.bat)
//
//	./studio                       (macOS / Linux, or run ./start-studio.sh)
package main

import (
	"context"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	openrouter "github.com/OpenRouterTeam/go-sdk"
	"github.com/OpenRouterTeam/go-sdk/models/components"
	"github.com/OpenRouterTeam/go-sdk/models/operations"
	"github.com/zalando/go-keyring"
	"gopkg.in/yaml.v3"
)

// Credential-store identifiers. We use these names everywhere (the server,
// the CLI subcommands, the helper scripts) so the user can grep for them.
const (
	keyringService = "creative-studio"
	keyringUser    = "openrouter-api-key"
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

// ----- credential lookup -----
//
// The server only READS the key; storing / clearing is handled by the
// platform-native scripts in scripts/.
//
// Lookup order:
//
//  1. $OPENROUTER_API_KEY environment variable
//     Useful for CI, containers, or one-off overrides. Always wins if set.
//
//  2. OS credential manager (Windows Credential Manager / macOS Keychain /
//     Secret Service on Linux). This is the recommended path for normal
//     desktop use — the key is stored encrypted in the OS vault, not in
//     plain-text files or environment variables that get inherited by
//     child processes. Set it up with scripts\set-key.bat (Windows) or
//     scripts/set-key.sh (macOS/Linux).

const (
	keySourceEnv     = "env"
	keySourceKeyring = "keyring"
)

// loadAPIKey returns the API key and which source it came from. An empty key
// with empty source means "not found anywhere".
func loadAPIKey() (string, string) {
	if env := strings.TrimSpace(os.Getenv("OPENROUTER_API_KEY")); env != "" {
		return env, keySourceEnv
	}
	v, err := keyring.Get(keyringService, keyringUser)
	if err != nil {
		// ErrNotFound is expected on first run; surface anything else so the
		// user knows the keyring is broken (e.g. on a headless server).
		if !errors.Is(err, keyring.ErrNotFound) {
			fmt.Fprintln(os.Stderr, "warning: could not read from OS credential manager:", err)
		}
		return "", ""
	}
	return strings.TrimSpace(v), keySourceKeyring
}

func main() {
	// The server has one job: serve. For credential management, see the
	// scripts in scripts/ (set-key.bat, clear-key.bat, where-is-the-key.bat, etc.).

	port := os.Getenv("STUDIO_PORT")
	if port == "" {
		port = defaultPort
	}

	apiKey, keySource := loadAPIKey()
	if apiKey == "" {
		fmt.Fprintln(os.Stderr, "ERROR: No OpenRouter API key found.")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "  Option A — OS credential manager (recommended):")
		fmt.Fprintln(os.Stderr, "    studio.exe set-key")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "  Option B — environment variable (one-off / CI):")
		fmt.Fprintln(os.Stderr, "    set OPENROUTER_API_KEY=sk-or-v1-...")
		os.Exit(1)
	}

	if keySource == keySourceEnv {
		fmt.Fprintln(os.Stderr, "note: using OPENROUTER_API_KEY env var; run `studio.exe set-key` to store it in the OS credential manager.")
	} else {
		fmt.Fprintln(os.Stderr, "note: using API key from OS credential manager.")
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

// loadModels returns the list of image and video models exposed in the UI.
//
// The list is read from a YAML file. The path is resolved in this order:
//
//  1. $STUDIO_MODELS env var (absolute or relative to CWD)
//  2. <binaryDir>/models.yaml  (same directory as the running executable)
//  3. <repoRoot>/dev/studio/models.yaml  (source-tree fallback for `go run`)
//  4. built-in defaults  (used only if every above is missing — and on
//     first run we *write* the defaults back to (2) so the user can see
//     the format and edit it)
//
// The file format is:
//
//	image:
//	  - id: x-ai/grok-imagine-image-quality
//	    name: Grok Imagine (Image) — quality
//	video:
//	  - id: bytedance/seedance-2.0
//	    name: Seedance 2.0 — video
//
// `id` is required; `name` is optional and defaults to `id`. Comments and
// blank lines are allowed.
func loadModels(ctx context.Context, client *openrouter.OpenRouter) modelLists {
	// Built-in defaults used as a last-resort fallback AND written out
	// on first run so the user has a model.yaml to edit.
	defaults := defaultModels()

	// Best-effort: confirm the API key works. We don't currently rewrite the
	// curated list with the live one because the full list is hundreds of
	// entries and most aren't relevant.
	if resp, err := client.Models.List(ctx, nil); err == nil && resp != nil {
		_ = resp
	} else if err != nil {
		fmt.Fprintln(os.Stderr, "warning: could not verify API key via /models:", err)
	}

	// Try to load from the YAML config file.
	path, err := resolveModelsPath()
	if err != nil || path == "" {
		// No path resolved; use defaults and move on.
		fmt.Fprintln(os.Stderr, "note: no models.yaml found; using built-in defaults.")
		return defaults
	}

	loaded, err := parseModelsYAML(path)
	if err != nil {
		// Config file exists but is broken — surface the error loudly so the
		// user fixes it. Fall back to defaults so the server still works.
		fmt.Fprintf(os.Stderr, "ERROR: failed to parse %s: %v\n", path, err)
		fmt.Fprintln(os.Stderr, "  Falling back to built-in defaults. Edit the file and restart.")
		return defaults
	}
	if loaded.Image == nil && loaded.Video == nil {
		// File was empty / had no recognized sections. Treat as "no models".
		return defaults
	}
	fmt.Fprintf(os.Stderr, "Loaded models from %s\n", path)
	return loaded
}

// modelsYAML is the on-disk schema. We only expose `id` and `name`; the
// id is the OpenRouter model identifier and name is what's shown in the
// dropdown. The shape is intentionally simple so a user can edit it in
// any text editor without learning the OpenRouter SDK.
type modelsYAML struct {
	Image []modelYAMLEntry `yaml:"image"`
	Video []modelYAMLEntry `yaml:"video"`
}

type modelYAMLEntry struct {
	ID   string `yaml:"id"`
	Name string `yaml:"name"`
}

// defaultModels is the curated list we ship with. It is the same content
// the server used before the YAML config was introduced, so upgrading
// users see no behavior change on day one.
func defaultModels() modelLists {
	return modelLists{
		Image: []modelEntry{
			{ID: "x-ai/grok-imagine-image-quality", Name: "Grok Imagine (Image) — quality"},
		},
		Video: []modelEntry{
			{ID: "bytedance/seedance-2.0", Name: "Seedance 2.0 — video"},
			{ID: "x-ai/grok-imagine-video", Name: "Grok Imagine — video"},
			{ID: "google/veo-3.1-lite", Name: "Veo 3.1 Lite — video"},
		},
	}
}

// resolveModelsPath determines which models.yaml to use. Returns ("", nil)
// if no candidate file exists (the caller should fall back to defaults).
// If a file doesn't exist but we know where it would go, we *create* it
// with the default contents so the user can immediately see the format.
func resolveModelsPath() (string, error) {
	candidates := modelsYAMLCandidates()
	// First existing candidate wins.
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	// None exist. Try to create one at the preferred location (binaryDir)
	// so the user has a discoverable file. We don't fail the server on
	// write errors here — just log.
	if len(candidates) > 0 {
		preferred := candidates[0]
		if err := writeDefaultModelsYAML(preferred); err != nil {
			fmt.Fprintf(os.Stderr, "warning: could not write default %s: %v\n", preferred, err)
		} else {
			fmt.Fprintf(os.Stderr, "Wrote default models to %s — edit it and restart to customize.\n", preferred)
		}
	}
	return "", nil
}

// modelsYAMLCandidates returns candidate paths in priority order:
//
//  1. $STUDIO_MODELS env var (if set)
//  2. <binaryDir>/models.yaml
//  3. <repoRoot>/dev/studio/models.yaml
func modelsYAMLCandidates() []string {
	var out []string
	if env := strings.TrimSpace(os.Getenv("STUDIO_MODELS")); env != "" {
		out = append(out, filepath.Clean(env))
	}
	if exe, err := os.Executable(); err == nil {
		out = append(out, filepath.Join(filepath.Dir(exe), "models.yaml"))
	}
	// Source-tree fallback: walk up to find the workspace root and use
	// dev/studio/models.yaml there. This makes `go run .` from a source
	// checkout work without extra setup.
	if cwd, err := os.Getwd(); err == nil {
		dir := cwd
		for i := 0; i < 6; i++ {
			if _, err := os.Stat(filepath.Join(dir, "dev", "studio", "go.mod")); err == nil {
				out = append(out, filepath.Join(dir, "dev", "studio", "models.yaml"))
				break
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	return out
}

// parseModelsYAML reads a models config file, validates each entry, and
// converts it into the modelLists shape the rest of the code uses.
func parseModelsYAML(path string) (modelLists, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return modelLists{}, err
	}
	var raw modelsYAML
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return modelLists{}, fmt.Errorf("yaml parse: %w", err)
	}

	out := modelLists{
		Image: yamlEntriesToModelEntries(raw.Image, "image"),
		Video: yamlEntriesToModelEntries(raw.Video, "video"),
	}
	return out, nil
}

// yamlEntriesToModelEntries trims, validates and converts raw YAML entries.
// An entry without an id is silently dropped (with a warning) — a name
// alone is not useful since it can't be sent to the SDK.
func yamlEntriesToModelEntries(in []modelYAMLEntry, section string) []modelEntry {
	out := make([]modelEntry, 0, len(in))
	for i, e := range in {
		id := strings.TrimSpace(e.ID)
		if id == "" {
			fmt.Fprintf(os.Stderr, "warning: %s[%d] has empty id; skipping.\n", section, i)
			continue
		}
		name := strings.TrimSpace(e.Name)
		if name == "" {
			name = id
		}
		out = append(out, modelEntry{ID: id, Name: name})
	}
	return out
}

// writeDefaultModelsYAML writes a commented default models.yaml to the
// given path. We write the comments manually (yaml.v3's Marshaler can't
// emit them) so the user can see the format and what's customizable.
func writeDefaultModelsYAML(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	d := defaultModels()
	var b strings.Builder
	b.WriteString("# Creative Studio — model list\n")
	b.WriteString("#\n")
	b.WriteString("# Edit this file to add or remove the models that show up in the\n")
	b.WriteString("# dropdown. Restart studio.exe after editing.\n")
	b.WriteString("#\n")
	b.WriteString("# Each entry needs an `id` (the OpenRouter model identifier) and\n")
	b.WriteString("# optionally a `name` (what's shown in the dropdown). If `name` is\n")
	b.WriteString("# omitted, the id is used as the name.\n")
	b.WriteString("#\n")
	b.WriteString("# Example: add a new image model by appending a new bullet under\n")
	b.WriteString("# `image:` — no need to touch any other file.\n")
	b.WriteString("\n")
	b.WriteString("image:\n")
	for _, m := range d.Image {
		fmt.Fprintf(&b, "  - id: %q\n    name: %q\n", m.ID, m.Name)
	}
	b.WriteString("\nvideo:\n")
	for _, m := range d.Video {
		fmt.Fprintf(&b, "  - id: %q\n    name: %q\n", m.ID, m.Name)
	}
	b.WriteString("\n")
	return os.WriteFile(path, []byte(b.String()), 0o644)
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

	// Read single-image first / last frame anchors (video only). Each is
	// independent of `ref`; the front-end disables them for image mode, but
	// we re-check server-side and silently ignore them for image generation.
	var frameFirst, frameLast *refImage
	if fhs := r.MultipartForm.File["frame_first"]; len(fhs) > 0 {
		if len(fhs) > 1 {
			http.Error(w, "frame_first must be a single image (max 1)", http.StatusBadRequest)
			return
		}
		img, err := readRefImage(fhs[0])
		if err != nil {
			http.Error(w, fmt.Sprintf("invalid frame_first image %q: %v", fhs[0].Filename, err), http.StatusBadRequest)
			return
		}
		frameFirst = &img
	}
	if fhs := r.MultipartForm.File["frame_last"]; len(fhs) > 0 {
		if len(fhs) > 1 {
			http.Error(w, "frame_last must be a single image (max 1)", http.StatusBadRequest)
			return
		}
		img, err := readRefImage(fhs[0])
		if err != nil {
			http.Error(w, fmt.Sprintf("invalid frame_last image %q: %v", fhs[0].Filename, err), http.StatusBadRequest)
			return
		}
		frameLast = &img
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
		// frame_first / frame_last are video-only; ignore them here.
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
		result, err := generateVideo(ctx, client, modelID, prompt, refImages, frameFirst, frameLast, params)
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
	Duration      int // seconds (server defaults to 5, clamped to 1..10)
	GenerateAudio bool
	// Size is the exact WIDTHxHEIGHT string (e.g. "1280x720"). When non-empty
	// it is mutually exclusive with AspectRatio + Resolution — the server
	// returns HTTP 400 if both are set.
	Size string
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
		Size:              strings.TrimSpace(r.FormValue("size")),
	}
	return p
}

// videoPolicy applies studio defaults / caps for video fields. It returns
// the resolved values plus an HTTP 400 message if validation fails.
//
//	Duration : blank → 5 seconds, clamped to 1..10
//	Resolution: blank → "720p"
//
// Size (WIDTHxHEIGHT) is mutually exclusive with AspectRatio + Resolution —
// callers must validate that before invoking.
func (p *genParams) applyVideoPolicy() (resolved genParams, errMsg string) {
	resolved = *p
	// Duration: default 5, clamp 1..10.
	if resolved.Duration == 0 {
		resolved.Duration = 5
	}
	if resolved.Duration < 1 || resolved.Duration > 10 {
		return genParams{}, fmt.Sprintf("duration must be between 1 and 10 seconds (got %d)", resolved.Duration)
	}
	// Resolution default.
	if strings.TrimSpace(resolved.Resolution) == "" {
		resolved.Resolution = "720p"
	}
	// Size format check (if provided).
	if resolved.Size != "" {
		if !sizePattern.MatchString(resolved.Size) {
			return genParams{}, fmt.Sprintf("size must be in WIDTHxHEIGHT format, e.g. 1280x720 (got %q)", resolved.Size)
		}
	}
	// Mutual exclusion: size vs (aspect_ratio + resolution).
	if resolved.Size != "" && (resolved.AspectRatio != "" || strings.TrimSpace(p.Resolution) != "") {
		return genParams{}, "size is mutually exclusive with aspect_ratio and resolution — set either size OR aspect_ratio (+ optional resolution), not both"
	}
	return resolved, ""
}

// sizePattern validates a WxH size string (e.g. "1280x720", "1920x1080").
// Width/height are 2-5 digits each, in the typical video range.
var sizePattern = regexp.MustCompile(`^[1-9][0-9]{1,4}x[1-9][0-9]{1,4}$`)

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

func generateVideo(ctx context.Context, client *openrouter.OpenRouter, modelID, prompt string, refs []refImage, firstFrame, lastFrame *refImage, p genParams) (genResult, error) {
	// Apply studio defaults & validation BEFORE talking to the SDK.
	resolved, errMsg := p.applyVideoPolicy()
	if errMsg != "" {
		return genResult{}, fmt.Errorf("%s", errMsg)
	}
	p = resolved

	req := components.VideoGenerationRequest{
		Model:  modelID,
		Prompt: prompt,
	}

	// Frame anchors come from the DEDICATED first/last frame inputs. They
	// are independent of the multi-image `ref` field — the form's first
	// and last slots are entirely separate from the reference list.
	if firstFrame != nil || lastFrame != nil {
		req.FrameImages = make([]components.FrameImage, 0, 2)
		if firstFrame != nil {
			req.FrameImages = append(req.FrameImages, components.FrameImage{
				Type:      components.FrameImageTypeImageURL,
				ImageURL:  components.FrameImageImageURL{URL: firstFrame.dataURL()},
				FrameType: components.FrameTypeFirstFrame,
			})
		}
		if lastFrame != nil {
			req.FrameImages = append(req.FrameImages, components.FrameImage{
				Type:      components.FrameImageTypeImageURL,
				ImageURL:  components.FrameImageImageURL{URL: lastFrame.dataURL()},
				FrameType: components.FrameTypeLastFrame,
			})
		}
	}

	// Reference images (up to 16) go to InputReferences using the union helper.
	// They are visual guides, NOT frame anchors.
	if len(refs) > 0 {
		req.InputReferences = make([]components.InputReference, 0, len(refs))
		for _, ref := range refs {
			img := components.ContentPartImage{
				ImageURL: components.ContentPartImageImageURL{URL: ref.dataURL()},
			}
			req.InputReferences = append(req.InputReferences,
				components.CreateInputReferenceImageURL(img))
		}
	}

	// Optional params. Each helper returns nil for "blank", which the SDK
	// omits from the request body via `omitzero`.
	// Note: Size is mutually exclusive with AspectRatio + Resolution (validated
	// in applyVideoPolicy), so at most one of these is non-empty here.
	if p.Size != "" {
		req.Size = &p.Size
	} else {
		if v := p.AspectRatio; v != "" {
			req.AspectRatio = (*components.VideoGenerationRequestAspectRatio)(&v)
		}
		if v := p.Resolution; v != "" {
			req.Resolution = (*components.VideoGenerationRequestResolution)(&v)
		}
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
