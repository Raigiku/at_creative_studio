#!/usr/bin/env bash
# Save your OpenRouter API key to the OS credential manager (macOS Keychain
# or Linux Secret Service). The key is stored encrypted and reused by the
# server on every launch.
#
# Usage:
#   ./set-key.sh              prompts for the key (input is hidden)
#   ./set-key.sh sk-or-v1-... stores the key from the first arg
#
# Native tools: `security` (macOS) / `secret-tool` (Linux).

set -euo pipefail

SERVICE="creative-studio"
USER="openrouter-api-key"

# Pick the right native tool for the platform.
if [[ "$(uname -s)" == "Darwin" ]]; then
    TOOL="mac"
else
    TOOL="linux"
fi

store_key() {
    local key="$1"
    if [[ "$TOOL" == "mac" ]]; then
        # `security add-generic-password -U` updates an existing entry if
        # present, so re-running set-key overwrites the previous key.
        security add-generic-password -U -s "$SERVICE" -a "$USER" -w "$key"
    else
        if ! command -v secret-tool >/dev/null 2>&1; then
            echo "ERROR: 'secret-tool' is not installed. Install it with your package manager (e.g. 'sudo apt install libsecret-tools' on Debian/Ubuntu, 'sudo dnf install libsecret' on Fedora)." >&2
            exit 1
        fi
        # `secret-tool store` overwrites if the same labels are given.
        echo -n "$key" | secret-tool store service "$SERVICE" account "$USER"
    fi
}

if [[ $# -ge 1 ]]; then
    key="$1"
else
    # Read the key silently. Try `read -s` first; fall back to a TTY-only
    # read via `</dev/tty` if stdin is redirected.
    echo -n "Enter your OpenRouter API key (input is hidden): "
    if [[ -t 0 ]]; then
        read -rs key
    else
        read -rs key < /dev/tty
    fi
    echo
fi

if [[ -z "$key" ]]; then
    echo "ERROR: empty key; nothing stored." >&2
    exit 1
fi

if [[ ! "$key" =~ ^sk-or- ]]; then
    echo "warning: key does not start with 'sk-or-'. Storing it anyway; double-check it's correct." >&2
fi

store_key "$key"

echo
echo "Stored API key in $([[ "$TOOL" == mac ]] && echo macOS\ Keychain || echo Linux\ Secret\ Service) under:"
echo "  service: $SERVICE"
echo "  account: $USER"
echo
echo "You can now run \`./start-studio.sh\` (or \`./studio\`) without setting any env vars."
