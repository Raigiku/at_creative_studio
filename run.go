// run.go
//
//go:build ignore

// Cross-platform launcher for the Creative Studio server.
//
// Usage from the repo root:
//
//	go run run.go
//
// This file is excluded from normal builds via the `ignore` build tag,
// so it does NOT conflict with `dev/studio` (which is also `package main`).
// It just shells out to `go run .` inside `dev/studio/`, which compiles
// the server, embeds the static/ directory, and starts it.
//
// The server itself reads OPENROUTER_API_KEY from the environment or
// from `.ai-creative-studio.env` in the parent directory of the repo —
// see dev/studio/credentials.go for the lookup order.
package main

import (
	"os"
	"os/exec"
)

func main() {
	cmd := exec.Command("go", "run", ".")
	cmd.Dir = "dev/studio"
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin
	if err := cmd.Run(); err != nil {
		os.Exit(cmd.ProcessState.ExitCode())
	}
}
