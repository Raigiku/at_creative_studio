package main

// Request-payload logging for the generation endpoints.
//
// When the server submits a generation to OpenRouter we log the
// request body to stderr. This is for debugging — "I sent X and got
// Y back" is the most common support question, and without the
// request you can't reproduce it.
//
// Two things we deliberately do NOT log:
//
//  1. The Authorization header. The server-side SDK takes care of
//     setting it; the value is never in our request struct, so it
//     can't leak through this path anyway. (Headers are logged by
//     the SDK's own transport on errors; we don't duplicate that.)
//
//  2. The base64 image data inside reference images and frame
//     anchors. A single 1024x1024 PNG is ~1 MiB; multi-ref and
//     image-to-image calls would dump several MiB of base64 noise
//     on every click. Instead we log a placeholder that records
//     the byte count and the kind of payload, so you can still
//     tell at a glance "1 PNG ref, 1 MP4 ref" without flooding
//     the terminal.
//
// The log view is a separate type from the SDK's request type.
// That keeps the redaction explicit and audit-friendly: a reader
// of this file can see exactly what gets logged, and the SDK's
// own fields can never accidentally bypass the redaction because
// the log view doesn't include them.

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/OpenRouterTeam/go-sdk/models/components"
)

// logGenerationRequest writes a redacted view of the SDK request to
// stderr. The label is "image" or "video" — it tells you which
// endpoint's log you're looking at when scrolling.
func logGenerationRequest(label string, payload any) {
	raw, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		// Never let logging break the actual generation.
		fmt.Fprintf(os.Stderr, "%s: <payload log marshal failed: %v>\n", label, err)
		return
	}
	fmt.Fprintf(os.Stderr, "[%s] OpenRouter request %s:\n%s\n",
		time.Now().Format("15:04:05.000"), label, raw)
}

// imageRefLog is the redacted form of one reference / frame image
// sent to OpenRouter. We replace the full data URL with a short
// placeholder that names the payload kind and its byte count.
type imageRefLog struct {
	Type     string `json:"type,omitempty"`
	Frame    string `json:"frame_type,omitempty"`
	ImageURL string `json:"image_url"`
}

// summarizeDataURL returns a placeholder string of the form
// "<base64 <mime>, N bytes>" for data: URLs, and the URL itself
// for http(s) URLs. Reference images are usually base64 data
// URLs (uploaded by the user), but the field also accepts
// ordinary URLs that some models allow — those are short and
// safe to log.
func summarizeDataURL(u string) string {
	const prefix = "data:"
	if !strings.HasPrefix(u, prefix) {
		// Ordinary URL — short, safe to log verbatim.
		return u
	}
	// data:<mime>;base64,<payload>
	rest := strings.TrimPrefix(u, prefix)
	semi := strings.IndexByte(rest, ';')
	if semi < 0 {
		return fmt.Sprintf("<data url, %d bytes>", len(u))
	}
	mime := rest[:semi]
	// The base64 portion starts after ";base64," (or just ";" for
	// non-base64 data URLs, which we don't expect here but handle
	// defensively).
	after := rest[semi+1:]
	var payloadLen int
	if strings.HasPrefix(after, "base64,") {
		payloadLen = len(after) - len("base64,")
	} else {
		payloadLen = len(after)
	}
	return fmt.Sprintf("<base64 %s, %d bytes>", mime, payloadLen)
}

// imageReqLog is the redacted log view of an ImageGenerationRequest.
// The SDK's own struct has more fields (Provider, Stream, Size, ...)
// that aren't currently set by the studio; if we ever start setting
// them, add them here.
type imageReqLog struct {
	Model           string         `json:"model"`
	Prompt          string         `json:"prompt"`
	InputReferences []imageRefLog  `json:"input_references,omitempty"`
	AspectRatio     string         `json:"aspect_ratio,omitempty"`
	Background      string         `json:"background,omitempty"`
	OutputFormat    string         `json:"output_format,omitempty"`
	Quality         string         `json:"quality,omitempty"`
	Resolution      string         `json:"resolution,omitempty"`
	N               *int64         `json:"n,omitempty"`
	Seed            *int64         `json:"seed,omitempty"`
	OutputCompression *int64       `json:"output_compression,omitempty"`
}

// videoReqLog is the redacted log view of a VideoGenerationRequest.
type videoReqLog struct {
	Model         string         `json:"model"`
	Prompt        string         `json:"prompt"`
	InputReferences []imageRefLog `json:"input_references,omitempty"`
	FrameImages   []imageRefLog  `json:"frame_images,omitempty"`
	AspectRatio   string         `json:"aspect_ratio,omitempty"`
	Resolution    string         `json:"resolution,omitempty"`
	Size          string         `json:"size,omitempty"`
	Duration      *int64         `json:"duration,omitempty"`
	GenerateAudio *bool          `json:"generate_audio,omitempty"`
	Seed          *int64         `json:"seed,omitempty"`
}

// logImageRequest builds the redacted log view of an
// ImageGenerationRequest and writes it to stderr.
func logImageRequest(req components.ImageGenerationRequest) {
	view := imageReqLog{
		Model:  req.Model,
		Prompt: req.Prompt,
	}
	if len(req.InputReferences) > 0 {
		view.InputReferences = make([]imageRefLog, 0, len(req.InputReferences))
		for _, r := range req.InputReferences {
			view.InputReferences = append(view.InputReferences, imageRefLog{
				Type:     string(r.Type),
				ImageURL: summarizeDataURL(r.ImageURL.URL),
			})
		}
	}
	if v := req.AspectRatio; v != nil {
		view.AspectRatio = string(*v)
	}
	if v := req.Background; v != nil {
		view.Background = string(*v)
	}
	if v := req.OutputFormat; v != nil {
		view.OutputFormat = string(*v)
	}
	if v := req.Quality; v != nil {
		view.Quality = string(*v)
	}
	if v := req.Resolution; v != nil {
		view.Resolution = string(*v)
	}
	view.N = req.N
	view.Seed = req.Seed
	view.OutputCompression = req.OutputCompression
	logGenerationRequest("image", view)
}

// logVideoRequest builds the redacted log view of a
// VideoGenerationRequest and writes it to stderr.
func logVideoRequest(req components.VideoGenerationRequest) {
	view := videoReqLog{
		Model:  req.Model,
		Prompt: req.Prompt,
	}
	if len(req.InputReferences) > 0 {
		view.InputReferences = make([]imageRefLog, 0, len(req.InputReferences))
		for _, r := range req.InputReferences {
			// Video request uses InputReference (a union of image,
			// audio, video). For image references, the URL lives
			// inside ContentPartImage. We log it the same way
			// (placeholder for data URLs, verbatim for http URLs).
			var url string
			var typ string
			if r.ContentPartImage != nil {
				url = r.ContentPartImage.ImageURL.URL
				typ = string(r.ContentPartImage.Type)
			} else if r.ContentPartAudio != nil {
				url = "<audio reference>"
				typ = string(r.Type)
			} else if r.ContentPartVideo != nil {
				url = "<video reference>"
				typ = string(r.Type)
			}
			view.InputReferences = append(view.InputReferences, imageRefLog{
				Type:     typ,
				ImageURL: summarizeDataURL(url),
			})
		}
	}
	if len(req.FrameImages) > 0 {
		view.FrameImages = make([]imageRefLog, 0, len(req.FrameImages))
		for _, f := range req.FrameImages {
			view.FrameImages = append(view.FrameImages, imageRefLog{
				Type:     string(f.Type),
				Frame:    string(f.FrameType),
				ImageURL: summarizeDataURL(f.ImageURL.URL),
			})
		}
	}
	if v := req.AspectRatio; v != nil {
		view.AspectRatio = string(*v)
	}
	if v := req.Resolution; v != nil {
		view.Resolution = string(*v)
	}
	if v := req.Size; v != nil {
		view.Size = *v
	}
	view.Duration = req.Duration
	view.GenerateAudio = req.GenerateAudio
	view.Seed = req.Seed
	logGenerationRequest("video", view)
}
