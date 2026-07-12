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

# --- 1. Make sure the binary exists and is up to date ---
#
# The Go binary embeds the static/ directory at compile time via
# //go:embed. If you edit app.js, index.html, or any other file in
# static/ without rebuilding, the running server keeps serving the
# OLD copies from the binary. We now rebuild automatically whenever
# the binary is older than any of the embedded source files, so the
# dev loop "edit → restart → see the change" just works.
#
# Pass --no-build to skip the rebuild check (e.g. in CI when you've
# already built in an earlier step).
SKIP_BUILD=0
for arg in "$@"; do
    if [[ "$arg" == "--no-build" ]]; then
        SKIP_BUILD=1
    fi
done

need_build=1
if [[ -x ./studio ]] && [[ "$SKIP_BUILD" == "0" ]]; then
    # Find the newest source file (Go or anything under static/) and
    # compare its mtime to the binary's. If any source is newer,
    # rebuild. Excludes node_modules and .git to avoid noise.
    newest_src=$(find . \( -name node_modules -o -name .git \) -prune \
                    -o -type f \( -name '*.go' -o -path './static/*' \) -print 2>/dev/null \
                | xargs -I {} stat -c '%Y %n' {} 2>/dev/null \
                | sort -rn | head -1 | cut -d' ' -f2-)
    if [[ -n "$newest_src" ]]; then
        src_mtime=$(stat -c '%Y' "$newest_src")
        bin_mtime=$(stat -c '%Y' ./studio)
        if (( src_mtime <= bin_mtime )); then
            need_build=0
        fi
    fi
elif [[ -x ./studio ]] && [[ "$SKIP_BUILD" == "1" ]]; then
    need_build=0
fi

if [[ "$need_build" == "1" ]]; then
    if [[ -x ./studio ]]; then
        echo "Source files newer than ./studio — rebuilding..."
    else
        # On macOS the build product is just `studio` (no extension).
        echo "Building studio..."
    fi
    if ! command -v go >/dev/null 2>&1; then
        echo
        echo "ERROR: Go is not installed. Install Go 1.25 or newer from https://go.dev/dl/"
        read -rp "Press Enter to exit..." _
        exit 1
    fi
    go build -o studio .

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
