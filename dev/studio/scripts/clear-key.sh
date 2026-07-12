#!/usr/bin/env bash
# Remove the API key from the OS credential manager.
#
# Native tools: `security` (macOS) / `secret-tool` (Linux).

set -euo pipefail

SERVICE="creative-studio"
USER="openrouter-api-key"

if [[ "$(uname -s)" == "Darwin" ]]; then
    if security delete-generic-password -s "$SERVICE" -a "$USER" >/dev/null 2>&1; then
        echo "Removed API key from macOS Keychain."
    else
        echo "No key was stored."
    fi
else
    if ! command -v secret-tool >/dev/null 2>&1; then
        echo "ERROR: 'secret-tool' is not installed." >&2
        exit 1
    fi
    if secret-tool clear service "$SERVICE" account "$USER" 2>/dev/null; then
        echo "Removed API key from Linux Secret Service."
    else
        echo "No key was stored."
    fi
fi
