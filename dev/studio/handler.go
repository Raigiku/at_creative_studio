package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	openrouter "github.com/OpenRouterTeam/go-sdk"
)

// genResult is the raw output of an image or video generation. The two
// fields are mutually exclusive in practice:
//
//   - Image: data is the full file in memory; ext is the format to write.
//   - Video: the file is already on disk (streamed straight from the CDN),
//     and path is the final name in outputDir. data is nil and the
//     handler uses path directly without re-saving.
type genResult struct {
	ext  string
	data []byte
	path string // set by video path; ignored by image path
}

// handleGenerate dispatches /api/generate to either image or video
// generation. It owns the request parsing, ref-image collection, the
// per-type dispatch, and the post-processing (saving to outputDir and
// returning the public URL). All SDK errors flow through classifySDKError
// to produce a uniform JSON envelope.
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
		// The cap is per-model: e.g. Grok Imagine allows 0–3 reference
		// images, while the form lets you pick up to 16. The UI
		// prevents the user from going over the model's cap, but we
		// validate again server-side as a safety net (the cap is read
		// from the in-memory capability cache, falling back to
		// maxReferenceImages if the model is unknown).
		cap := refImagesMaxForModel(modelID)
		if len(files) > cap {
			http.Error(w, fmt.Sprintf("too many reference images: %d (max %d for model %s)", len(files), cap, modelID), http.StatusBadRequest)
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
			status, ge := classifySDKError(err)
			writeGenError(w, genType, modelID, status, ge, err)
			return
		}
		fileName, err := saveOutput(outputDir, genType, modelID, result.ext, result.data)
		if err != nil {
			fmt.Fprintf(os.Stderr, "save failed (image, model=%s): %v\n", modelID, err)
			writeGenError(w, genType, modelID, http.StatusInternalServerError, genError{
				Message: "saved file write failed: " + err.Error(),
				Code:    errCodeInternal,
			}, err)
			return
		}
		writeJSON(w, map[string]any{
			"kind": "image",
			"path": fileName,
			"url":  "/api/output/" + fileName,
		})
	case "video":
		result, err := generateVideo(ctx, client, modelID, prompt, refImages, frameFirst, frameLast, params, outputDir)
		if err != nil {
			// generateVideo may return either an SDK error OR a "video job
			// failed: <reason>" string for terminal job states. Try the
			// SDK path first; if it doesn't recognize the error (returns
			// errCodeInternal), treat it as a video-failed job.
			status, ge := classifySDKError(err)
			if ge.Code == errCodeInternal {
				status = http.StatusBadGateway
				ge = genError{
					Message:   "the video job ended unsuccessfully: " + err.Error(),
					Code:      errCodeVideoFailed,
					Retryable: true,
				}
			}
			writeGenError(w, genType, modelID, status, ge, err)
			return
		}
		if result.path == "" {
			writeGenError(w, genType, modelID, http.StatusInternalServerError, genError{
				Message: "video result had no on-disk path",
				Code:    errCodeInternal,
			}, nil)
			return
		}
		writeJSON(w, map[string]any{
			"kind": "video",
			"path": result.path,
			"url":  "/api/output/" + result.path,
		})
	}
}

// writeJSON serializes v as JSON with the right Content-Type. Encoding
// errors are logged (the response is already partially written at that
// point so we can't recover).
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
