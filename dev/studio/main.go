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
	"fmt"
	"io/fs"
	"net/http"
	"os"

	openrouter "github.com/OpenRouterTeam/go-sdk"
)

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
