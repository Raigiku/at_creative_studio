#!/usr/bin/env bash
# Creative Studio launcher for macOS (and Linux, since the .sh scripts in
# scripts/ support both). Windows users have start-studio.bat.
#
# The API key is loaded from the OS credential manager (macOS Keychain /
# Linux Secret Service). On first run, run scripts/set-key.sh to store it.
# You can also set OPENROUTER_API_KEY in your environment to override.

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
# Probe the same way the Windows launcher does: run where-is-the-key.sh
# and bail out early if it reports no key. This avoids starting the
# server only to die with a "no key" error after the browser tab opens.
if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
    if ./scripts/where-is-the-key.sh | grep -q "No key found"; then
        echo
        echo "============================================================"
        echo "  No OpenRouter API key found."
        echo
        echo "  Run this once to store your key in the OS credential"
        echo "  manager. You only need to do this once."
        echo
        echo "      ./scripts/set-key.sh"
        echo
        echo "  Or set the OPENROUTER_API_KEY env var for this session:"
        echo
        echo "      export OPENROUTER_API_KEY=sk-or-v1-..."
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
