#!/usr/bin/env bash
# Creative Studio launcher for macOS (and Linux, since the .sh scripts in
# scripts/ support both). Windows users have start-studio.bat.
#
# The API key is loaded in this order:
#   1. $OPENROUTER_API_KEY env var (always wins if set)
#   2. .ai-creative-studio.env file ONE DIRECTORY ABOVE the repo
#
# Example: if the repo is at ~/code/ai_creative_studio, the .env file
# should live at ~/code/.ai-creative-studio.env with the line:
#     OPENROUTER_API_KEY=sk-or-v1-...

set -euo pipefail

export STUDIO_PORT="${STUDIO_PORT:-7878}"

# Always run from the directory containing this script, regardless of
# where the user invoked it from.
cd "$(dirname "$(readlink -f "$0")")"

# --- 1. Make sure the binary exists (build if needed) ---
# On macOS the build product is just `studio` (no extension).
if [[ ! -x ./studio ]]; then
    echo "Building studio..."
    if ! command -v go >/dev/null 2>&1; then
        echo
        echo "ERROR: Go is not installed. Install Go 1.25 or newer from https://go.dev/dl/"
        read -rp "Press Enter to exit..." _
        exit 1
    fi
    go build -o studio .
fi

# --- 2. Pre-flight check: do we have a key somewhere? ---
# Fast path: env var is set. The server will use it directly.
if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
    # Slow path: walk up from the script's directory looking for the
    # .env file, mirroring the server's logic so the user gets a clear
    # hint BEFORE the server even starts.
    probe_dir="$(pwd)"
    found=""
    while [[ "$probe_dir" != "/" && "$probe_dir" != "." ]]; do
        if [[ -f "$probe_dir/.ai-creative-studio.env" ]]; then
            found="$probe_dir/.ai-creative-studio.env"
            break
        fi
        probe_dir="$(dirname "$probe_dir")"
    done
    if [[ -z "$found" ]]; then
        echo
        echo "============================================================"
        echo "  No OpenRouter API key found."
        echo
        echo "  Create this file (one directory above the repo):"
        echo "      $(pwd)/../.ai-creative-studio.env"
        echo
        echo "  With the single line:"
        echo "      OPENROUTER_API_KEY=sk-or-v1-..."
        echo
        echo "  Or export OPENROUTER_API_KEY in your environment for"
        echo "  this session."
        echo "============================================================"
        echo
        read -rp "Press Enter to exit..." _
        exit 1
    fi
fi

echo
echo "Starting Creative Studio on http://localhost:${STUDIO_PORT}"
echo "Close this window or press Ctrl+C to stop."
echo

# Open the browser after a short delay so the server is listening first.
# `open` on macOS uses the default browser; on Linux fall back to xdg-open.
(
    sleep 2
    if command -v open >/dev/null 2>&1; then
        open "http://localhost:${STUDIO_PORT}"
    elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "http://localhost:${STUDIO_PORT}"
    fi
) &

exec ./studio
