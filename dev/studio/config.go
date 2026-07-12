package main

import (
	"embed"
	"time"
)

//go:embed static
var staticFS embed.FS

const (
	defaultPort     = "7878"
	videoPollEvery  = 5 * time.Second
	videoTimeoutMax = 10 * time.Minute
	defaultOutDir   = "ai_outputs"

	// maxReferenceImages is the hard cap on the number of reference images
	// the user may upload for image-to-image / image-to-video. Enforced both
	// client-side (UI rejects >16 picks) and server-side (HTTP 400 if violated).
	maxReferenceImages = 16

	// maxDownloadBytes is the hard cap on how large a single generated
	// video can be. OpenRouter pre-signs CDN URLs and we stream the
	// response straight to disk, so we have to enforce the limit while
	// reading (otherwise a malicious or buggy provider could OOM us with
	// a multi-gigabyte response). 500 MiB is comfortably larger than
	// any current text-to-video output and still small enough that an
	// entire folder of them fits on a typical laptop.
	maxDownloadBytes = 500 << 20
)

// Cached at startup so we don't refetch the model list on every page load.
type modelLists struct {
	Image []modelEntry `json:"image"`
	Video []modelEntry `json:"video"`
}

type modelEntry struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Source tags returned by loadAPIKey so the server can print a useful
// "where did your key come from?" hint at startup.
const (
	keySourceEnv     = "env"
	keySourceEnvFile = "envfile"
)
