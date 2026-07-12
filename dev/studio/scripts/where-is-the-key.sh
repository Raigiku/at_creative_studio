#!/usr/bin/env bash
# Show which credential source the server will use on next start, without
# exposing the key itself. Pure stdlib \226 no native tool required.

if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then
    env_set="set"
else
    env_set="not set"
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
    if security find-generic-password -s "creative-studio" -a "openrouter-api-key" >/dev/null 2>&1; then
        kr_set="set (Target=creative-studio, Account=openrouter-api-key)"
    else
        kr_set="not set"
    fi
else
    if ! command -v secret-tool >/dev/null 2>&1; then
        kr_set="unknown (secret-tool not installed)"
    elif echo -n "x" | secret-tool lookup service creative-studio account openrouter-api-key >/dev/null 2>&1; then
        kr_set="set (service=creative-studio, account=openrouter-api-key)"
    else
        kr_set="not set"
    fi
fi

echo "Credential lookup order:"
echo "  1. \$OPENROUTER_API_KEY env var  : $env_set"
echo "  2. OS credential manager        : $kr_set"

if [[ "$env_set" == "not set" && "$kr_set" == "not set" ]]; then
    echo "  -> No key found. The server will refuse to start."
    echo "  -> Run ./set-key.sh to store one."
elif [[ "$env_set" == "set" ]]; then
    echo "  -> Server will use: env var (overrides credential manager)."
else
    echo "  -> Server will use: OS credential manager."
fi
