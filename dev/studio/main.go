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
// API key: loaded in this order:
//
//  1. $OPENROUTER_API_KEY environment variable (always wins if set)
//  2. .ai-creative-studio.env in the parent directory of the repo
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
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"

	openrouter "github.com/OpenRouterTeam/go-sdk"
)

func main() {
	port := os.Getenv("STUDIO_PORT")
	if port == "" {
		port = defaultPort
	}

	apiKey, keySource := loadAPIKey()
	if apiKey == "" {
		fmt.Fprintln(os.Stderr, "ERROR: No OpenRouter API key found.")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "  Option A — set the environment variable for this session:")
		fmt.Fprintln(os.Stderr, "    set OPENROUTER_API_KEY=sk-or-v1-...")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "  Option B — create a .env file one directory above the repo:")
		fmt.Fprintf(os.Stderr, "    %s\\%s\n", repoParentDir(), envFileName)
		fmt.Fprintln(os.Stderr, "    with the line:")
		fmt.Fprintln(os.Stderr, "    OPENROUTER_API_KEY=sk-or-v1-...")
		os.Exit(1)
	}

	switch keySource {
	case keySourceEnv:
		fmt.Fprintln(os.Stderr, "note: using OPENROUTER_API_KEY from the process environment.")
	case keySourceEnvFile:
		fmt.Fprintln(os.Stderr, "note: using OPENROUTER_API_KEY from a .env file above the repo.")
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
	// Per-model capabilities: GET /api/models/{id}
	// {id} is the full OpenRouter model id, e.g.
	// "x-ai/grok-imagine-image-quality". Note the id itself
	// contains a "/" (author/slug), so we use the trailing "/" on
	// the route pattern but accept any non-empty remainder. We
	// split it server-side into author/slug for the SDK call.
	// Returns the SDK-derived SupportedParameters + modality list,
	// plus any built-in quirks for the model. Used by the UI to
	// (a) hide form fields the model doesn't accept at all, and
	// (b) show "Note: this model only accepts resolution 1K or 2K"
	// hints. Cached in memory for 1 hour per model id.
	mux.HandleFunc("GET /api/models/", func(w http.ResponseWriter, r *http.Request) {
		// The id may contain "/" (author/slug), so we can't reject
		// paths with internal slashes — we just need a non-empty
		// remainder. The capabilities handler will URL-decode the
		// path again; we just need to dispatch to it.
		handleModelCapabilities(w, r, client)
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

// repoParentDir returns the absolute path of the directory that should
// contain the .env file (one level above the repo). Used only in the
// "no key found" error message so the user knows where to put it.
func repoParentDir() string {
	anchor, err := os.Executable()
	if err != nil || anchor == "" {
		anchor, _ = os.Getwd()
	} else {
		anchor = filepath.Dir(anchor)
	}
	if anchor == "" {
		return "<parent-of-repo>"
	}
	// Walk up until we find the repo root (a directory that contains
	// "go.mod"). Return its parent.
	dir := anchor
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return filepath.Dir(dir)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return filepath.Dir(anchor)
		}
		dir = parent
	}
}
