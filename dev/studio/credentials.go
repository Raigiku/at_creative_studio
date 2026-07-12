package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

// ----- credential lookup -----
//
// The server only READS the key; storing / clearing is handled by the
// user (a plain .env file in their dev folder).
//
// Lookup order:
//
//  1. $OPENROUTER_API_KEY environment variable
//     Always wins if set. Useful for one-off overrides and CI.
//
//  2. <parentOfRepo>/.ai-creative-studio.env
//     A plain dotenv file. This is the recommended path for normal
//     desktop use. The file is read once at startup; changes take
//     effect on the next launch. Format:
//
//         # .ai-creative-studio.env
//         OPENROUTER_API_KEY=sk-or-v1-...
//
//     The file must live ONE DIRECTORY ABOVE the repo root
//     (c:\custom\projects\.ai-creative-studio.env for the bundled
//     repo) so that:
//
//       - it is outside the repo and never accidentally committed
//       - multiple repos under the same parent directory can share
//         a single key file
//       - the same path works in `go run` (where the repo is the
//         cwd) and from the compiled binary (which lives inside the
//         repo and walks up to find the same parent)

const (
	// envFileName is the dotenv file the studio reads at startup.
	// It must live in the parent directory of the repo, not inside it.
	envFileName = ".ai-creative-studio.env"
	// envVarName is the variable inside the dotenv file (and in the
	// process environment) that holds the OpenRouter API key.
	envVarName = "OPENROUTER_API_KEY"
)

// loadAPIKey returns the API key and which source it came from. An
// empty key with empty source means "not found anywhere".
func loadAPIKey() (string, string) {
	// 1. Process env wins. Strip whitespace in case the user set it
	//    via `set KEY=value with spaces` style.
	if env := strings.TrimSpace(os.Getenv(envVarName)); env != "" {
		return env, keySourceEnv
	}

	// 2. Dotenv file above the repo. We walk up from the executable
	//    (or the cwd, in `go run` mode) until we find a directory
	//    containing the .env file. We do NOT search inside the repo
	//    itself — keeping secrets outside the repo is the whole point.
	path, err := findEnvFile()
	if err != nil {
		// A real error reading the file (permissions, etc.) is worth
		// surfacing. Missing file is silent — that's the normal case
		// for a fresh setup.
		fmt.Fprintf(os.Stderr, "warning: could not read %s: %v\n", envFileName, err)
		return "", ""
	}
	if path == "" {
		return "", ""
	}
	v, err := parseDotenv(path, envVarName)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: could not parse %s: %v\n", path, err)
		return "", ""
	}
	trimmed := strings.TrimSpace(v)
	// Defense in depth: catch values corrupted by bad input. If we
	// pass a value with a newline or non-ASCII byte to the SDK, net/http
	// refuses to build the Authorization header with the opaque error
	//   "invalid header field value for \"Authorization\""
	// which gives the user no clue. Reject it here instead.
	if trimmed != v {
		fmt.Fprintf(os.Stderr, "warning: %s contained leading/trailing whitespace; trimmed it.\n", path)
	}
	if !validAPIKey(trimmed) {
		fmt.Fprintf(os.Stderr, "ERROR: %s contains a malformed value (length=%d, first char U+%04X).\n",
			path, len(trimmed), firstCodepoint(trimmed))
		fmt.Fprintf(os.Stderr, "  Expected: %s=sk-... (30-200 URL-safe ASCII chars, no whitespace).\n", envVarName)
		return "", ""
	}
	return trimmed, keySourceEnvFile
}

// findEnvFile walks up from the executable's directory looking for
// envFileName. Stops as soon as:
//
//   - the file is found (returns its absolute path), or
//   - we reach the filesystem root (returns "").
//
// We do NOT stop at the repo boundary — we walk all the way up. The
// file is expected to live OUTSIDE the repo, so any repo-internal
// stop condition would be the wrong one.
func findEnvFile() (string, error) {
	// Anchor: prefer the directory of the running executable, fall
	// back to the current working directory for `go run` (where the
	// binary is in a temp build dir and cwd is the package dir).
	anchor, err := os.Executable()
	if err != nil || anchor == "" {
		anchor, _ = os.Getwd()
	} else {
		anchor = filepath.Dir(anchor)
	}
	if anchor == "" {
		return "", nil
	}

	dir := anchor
	for {
		candidate := filepath.Join(dir, envFileName)
		if fi, err := os.Stat(candidate); err == nil && !fi.IsDir() {
			return candidate, nil
		} else if err != nil && !os.IsNotExist(err) {
			return "", err
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			// Reached the filesystem root without finding the file.
			return "", nil
		}
		dir = parent
	}
}

// parseDotenv reads a dotenv file and returns the value of the named
// variable. Supports:
//
//   - blank lines and `#` comments
//   - optional `export ` prefix
//   - optional surrounding double or single quotes around the value
//   - inline comments after a quoted value
//
// This is intentionally a small, dependency-free parser. We do NOT
// support variable expansion (${OTHER}) or escape sequences beyond
// what you get from the simple "strip surrounding quotes" rule.
func parseDotenv(path, key string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	// Allow reasonably long values (API keys + a margin). 4 KiB is
	// comfortable for a single secret; anything bigger is almost
	// certainly a malformed file.
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		eq := strings.IndexByte(line, '=')
		if eq <= 0 {
			continue
		}
		k := strings.TrimSpace(line[:eq])
		if k != key {
			continue
		}
		// Found our key. Extract the raw value.
		raw := strings.TrimSpace(line[eq+1:])
		// Strip surrounding quotes if present.
		if len(raw) >= 2 {
			first, last := raw[0], raw[len(raw)-1]
			if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
				raw = raw[1 : len(raw)-1]
			}
		}
		// Strip a trailing inline comment for UNQUOTED values only.
		// Quoted values may legitimately contain '#'.
		if !looksQuotedOriginally(line[eq+1:]) {
			if i := strings.IndexByte(raw, '#'); i >= 0 {
				raw = strings.TrimSpace(raw[:i])
			}
		}
		return raw, nil
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	return "", nil // key not present in the file
}

// looksQuotedOriginally reports whether the raw RHS of a dotenv line
// started with a quote character. Used to decide whether a trailing
// '#' is an inline comment or part of the value.
func looksQuotedOriginally(rhs string) bool {
	trimmed := strings.TrimLeft(rhs, " \t")
	return len(trimmed) > 0 && (trimmed[0] == '"' || trimmed[0] == '\'')
}

// validAPIKey rejects values that would make net/http reject the
// Authorization header. We deliberately do NOT enforce a specific
// prefix (like "sk-or-v1-") because OpenRouter has shipped multiple
// key formats over time and gating on a specific prefix produced a
// confusing error for users with newer keys. The only thing we
// actually need to verify is that the value is safe to put into an
// HTTP header.
func validAPIKey(k string) bool {
	if !strings.HasPrefix(k, "sk-") {
		return false
	}
	if len(k) < 30 || len(k) > 200 {
		return false
	}
	// Mirror httpguts.ValidHeaderFieldValue: reject whitespace, control
	// chars, DEL, and non-ASCII. This is the same check net/http runs
	// internally before sending the request, and it's the only check
	// that actually matters for the "invalid header field value" bug.
	for _, r := range k {
		if r > unicode.MaxASCII {
			return false
		}
		if r <= ' ' || r == 0x7f {
			return false
		}
	}
	return true
}

// firstCodepoint is a small helper so the error message can show what
// the stored value actually starts with (without dumping the whole key).
func firstCodepoint(s string) rune {
	for _, r := range s {
		return r
	}
	return 0
}
