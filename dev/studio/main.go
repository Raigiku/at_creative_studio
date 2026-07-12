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
//	GET  /api/models/{id} — returns one model's capabilities block, or null
//	POST /api/generate  — accepts multipart form, dispatches gen, returns { kind, url, path }
//	GET  /api/output/   — serves files from the ai_outputs/ directory
//
// Model list + per-model UI config comes from models.yaml (with built-in
// defaults if no file is found). See models.go for the file format and
// resolution order.
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

	client := openrouter.New(
		openrouter.WithSecurity(apiKey),
		// Wrap the default HTTP client so every request to OpenRouter
		// gets a one-line stderr log of (status, duration). This is
		// what makes 504s diagnosable: a 504 in 30s is an upstream
		// failure, a 504 after our 10-minute timeout is our own
		// deadline firing. The status code alone can't tell those apart.
		// The label "openrouter" is a fallback for any non-generation
		// call (e.g. the pre-warm model list fetch); per-endpoint
		// labels aren't worth the plumbing because the path makes
		// it clear which call is which.
		openrouter.WithClient(&timingClient{
			inner: http.DefaultClient,
			label: "openrouter",
		}),
	)

	// Resolve the output directory. Priority:
	//   1. $AI_OUTPUTS_DIR (absolute or relative to CWD)
	//   2. <repoRoot>/ai_outputs  (created on first run)
	outputDir := resolveOutputDir()
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: cannot create output dir %s: %v\n", outputDir, err)
		os.Exit(1)
	}

	// Load the model list once at startup. The list comes from
	// models.yaml — the file is required; the server fails fast
	// if it's missing or unparseable. Copy models.example.yaml
	// to models.yaml (or set $STUDIO_MODELS) to get going.
	//
	// No network calls are made here — we don't query OpenRouter
	// for per-model capabilities. The model list IS the contract.
	models, err := loadModels()
	if err != nil {
		fmt.Fprintln(os.Stderr, "ERROR:", err)
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "  To fix:")
		fmt.Fprintln(os.Stderr, "    - Copy models.example.yaml to models.yaml and edit it, OR")
		fmt.Fprintln(os.Stderr, "    - Set STUDIO_MODELS to an existing models.yaml file")
		os.Exit(1)
	}

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
	// the route pattern but accept any non-empty remainder.
	// Returns the model's capabilities block (or JSON null if the
	// model has no block), or 404 if the model isn't in models.yaml.
	mux.HandleFunc("GET /api/models/", func(w http.ResponseWriter, r *http.Request) {
		handleModelCaps(w, r, models)
	})
	mux.HandleFunc("POST /api/generate", func(w http.ResponseWriter, r *http.Request) {
		handleGenerate(w, r, client, outputDir, models)
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
