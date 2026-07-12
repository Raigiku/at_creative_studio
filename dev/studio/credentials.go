package main

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/zalando/go-keyring"
)

// ----- credential lookup -----
//
// The server only READS the key; storing / clearing is handled by the
// platform-native scripts in scripts/.
//
// Lookup order:
//
//  1. $OPENROUTER_API_KEY environment variable
//     Useful for CI, containers, or one-off overrides. Always wins if set.
//
//  2. OS credential manager (Windows Credential Manager / macOS Keychain /
//     Secret Service on Linux). This is the recommended path for normal
//     desktop use — the key is stored encrypted in the OS vault, not in
//     plain-text files or environment variables that get inherited by
//     child processes. Set it up with scripts\set-key.bat (Windows) or
//     scripts/set-key.sh (macOS/Linux).

// loadAPIKey returns the API key and which source it came from. An empty key
// with empty source means "not found anywhere".
func loadAPIKey() (string, string) {
	if env := strings.TrimSpace(os.Getenv("OPENROUTER_API_KEY")); env != "" {
		return env, keySourceEnv
	}
	v, err := keyring.Get(keyringService, keyringUser)
	if err != nil {
		// ErrNotFound is expected on first run; surface anything else so the
		// user knows the keyring is broken (e.g. on a headless server).
		if !errors.Is(err, keyring.ErrNotFound) {
			fmt.Fprintln(os.Stderr, "warning: could not read from OS credential manager:", err)
		}
		return "", ""
	}
	return strings.TrimSpace(v), keySourceKeyring
}
