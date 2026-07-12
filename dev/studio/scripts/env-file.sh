#!/usr/bin/env bash
# Create .ai-creative-studio.env one directory above the repo and store
# your OpenRouter API key in it. This is the recommended way to provide
# the key to the studio.
#
# Usage:
#   ./scripts/env-file.sh                       prompts for the key
#   ./scripts/env-file.sh sk-or-v1-...          stores the key from the first arg
#
# The .env file lives at: <parent-of-repo>/.ai-creative-studio.env
# For the bundled repo that is /path/to/parent/.ai-creative-studio.env
#
# Re-run this script any time you want to update the key. The server
# reads the file on each launch, so just restart studio afterwards.

set -euo pipefail

# Walk up from this script's directory until we find the repo root
# (a directory containing go.mod). The .env file goes in its parent.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
candidate="$SCRIPT_DIR"
while [[ "$candidate" != "/" && "$candidate" != "." ]]; do
    if [[ -f "$candidate/go.mod" ]]; then
        parent="$(dirname "$candidate")"
        ENV_FILE="$parent/.ai-creative-studio.env"
        break
    fi
    candidate="$(dirname "$candidate")"
done

if [[ -z "${ENV_FILE:-}" ]]; then
    echo "ERROR: could not find a go.mod in any parent directory." >&2
    echo "       Run this script from inside the ai_creative_studio repo." >&2
    exit 1
fi

# Read the key (hidden prompt if no arg was given).
if [[ $# -ge 1 ]]; then
    KEY="$1"
else
    read -r -s -p "Enter your OpenRouter API key (input is hidden): " KEY
    echo
fi

if [[ -z "$KEY" ]]; then
    echo "ERROR: empty key; nothing stored." >&2
    exit 1
fi

# Validate the key shape. Reject anything that doesn't look like a real
# OpenRouter key so we fail fast instead of saving garbage.
if ! [[ "$KEY" =~ ^sk-[A-Za-z0-9._-]{20,}$ ]]; then
    echo "ERROR: the value does not look like an OpenRouter API key." >&2
    echo "Expected format: sk-... with no whitespace or newlines." >&2
    exit 1
fi

# Write the file. Use a heredoc with a quoted delimiter to prevent any
# shell expansion of the key contents.
cat > "$ENV_FILE" <<EOF
# Creative Studio — OpenRouter API key
# Created by scripts/env-file.sh
OPENROUTER_API_KEY=$KEY
EOF

echo
echo "Wrote API key to: $ENV_FILE"
echo
echo "Restart the studio (or run start-studio.sh) and the server will pick it up."
