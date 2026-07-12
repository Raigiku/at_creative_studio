package main

import (
	"encoding/base64"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

// refImage holds an uploaded reference image, decoded fully in memory.
// Reference images are small (typically a few MB max) so this is fine;
// videos are streamed to disk instead.
type refImage struct {
	filename string
	mime     string
	data     []byte
}

func readRefImage(fh *multipart.FileHeader) (refImage, error) {
	f, err := fh.Open()
	if err != nil {
		return refImage{}, err
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		return refImage{}, err
	}
	mime := fh.Header.Get("Content-Type")
	if mime == "" {
		mime = "image/png"
	}
	return refImage{
		filename: fh.Filename,
		mime:     mime,
		data:     data,
	}, nil
}

// dataURL returns a base64 data URL the SDK can consume directly.
// Format: data:<mime>;base64,<bytes>
func (r refImage) dataURL() string {
	return "data:" + r.mime + ";base64," + base64.StdEncoding.EncodeToString(r.data)
}

// genParams holds all optional generation parameters collected from the form.
// Empty strings / zero values mean "use the provider default" — the SDK has
// `omitzero` on these fields, so a nil pointer results in the JSON key being
// omitted entirely.
type genParams struct {
	// Image
	AspectRatio       string // e.g. "1:1", "16:9", "auto"
	Background        string // "auto", "transparent", "opaque"
	OutputFormat      string // "png", "jpeg", "webp", "svg"
	Quality           string // "auto", "low", "medium", "high"
	Resolution        string // image: "512","1K","2K","4K"  | video: "480p","720p","1080p","1K","2K","4K"
	N                 int    // 1..10
	OutputCompression int    // 0..100 (jpeg/webp only)
	Seed              int

	// Video
	Duration      int // seconds (server defaults to 5, clamped to 1..10)
	GenerateAudio bool
	// Size is the exact WIDTHxHEIGHT string (e.g. "1280x720"). When non-empty
	// it is mutually exclusive with AspectRatio + Resolution — the server
	// returns HTTP 400 if both are set.
	Size string
}

// readGenParams pulls every optional field off the multipart form. Missing or
// blank values stay as the zero value of their type.
func readGenParams(r *http.Request) genParams {
	p := genParams{
		AspectRatio:       strings.TrimSpace(r.FormValue("aspect_ratio")),
		Background:        strings.TrimSpace(r.FormValue("background")),
		OutputFormat:      strings.TrimSpace(r.FormValue("output_format")),
		Quality:           strings.TrimSpace(r.FormValue("quality")),
		Resolution:        strings.TrimSpace(r.FormValue("resolution")),
		N:                 atoiOrZero(r.FormValue("n")),
		OutputCompression: atoiOrZero(r.FormValue("output_compression")),
		Seed:              atoiOrZero(r.FormValue("seed")),
		Duration:          atoiOrZero(r.FormValue("duration")),
		GenerateAudio:     r.FormValue("generate_audio") == "on" || r.FormValue("generate_audio") == "true",
		Size:              strings.TrimSpace(r.FormValue("size")),
	}
	return p
}

// videoPolicy applies studio defaults / caps for video fields. It returns
// the resolved values plus an HTTP 400 message if validation fails.
//
//	Duration : blank → 5 seconds, clamped to 1..10
//	Resolution: blank → "720p"
//
// Size (WIDTHxHEIGHT) is mutually exclusive with AspectRatio + Resolution —
// callers must validate that before invoking.
func (p *genParams) applyVideoPolicy() (resolved genParams, errMsg string) {
	resolved = *p
	// Duration: default 5, clamp 1..10.
	if resolved.Duration == 0 {
		resolved.Duration = 5
	}
	if resolved.Duration < 1 || resolved.Duration > 10 {
		return genParams{}, fmt.Sprintf("duration must be between 1 and 10 seconds (got %d)", resolved.Duration)
	}
	// Resolution default.
	if strings.TrimSpace(resolved.Resolution) == "" {
		resolved.Resolution = "720p"
	}
	// Size format check (if provided).
	if resolved.Size != "" {
		if !sizePattern.MatchString(resolved.Size) {
			return genParams{}, fmt.Sprintf("size must be in WIDTHxHEIGHT format, e.g. 1280x720 (got %q)", resolved.Size)
		}
	}
	// Mutual exclusion: size vs (aspect_ratio + resolution).
	if resolved.Size != "" && (resolved.AspectRatio != "" || strings.TrimSpace(p.Resolution) != "") {
		return genParams{}, "size is mutually exclusive with aspect_ratio and resolution — set either size OR aspect_ratio (+ optional resolution), not both"
	}
	return resolved, ""
}

// sizePattern validates a WxH size string (e.g. "1280x720", "1920x1080").
// Width/height are 2-5 digits each, in the typical video range.
var sizePattern = regexp.MustCompile(`^[1-9][0-9]{1,4}x[1-9][0-9]{1,4}$`)

func atoiOrZero(s string) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return n
}

// strPtr is a tiny helper for setting optional SDK string fields.
func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func int64Ptr(n int) *int64 {
	if n == 0 {
		return nil
	}
	v := int64(n)
	return &v
}

func boolPtr(b bool) *bool {
	if !b {
		return nil
	}
	return &b
}
