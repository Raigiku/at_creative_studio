package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	openrouter "github.com/OpenRouterTeam/go-sdk"
	"github.com/OpenRouterTeam/go-sdk/models/components"
	"github.com/OpenRouterTeam/go-sdk/models/operations"
)

func generateVideo(ctx context.Context, client *openrouter.OpenRouter, modelID, prompt string, refs []refImage, firstFrame, lastFrame *refImage, p genParams, outputDir string) (genResult, error) {
	// Apply studio defaults & validation BEFORE talking to the SDK.
	resolved, errMsg := p.applyVideoPolicy()
	if errMsg != "" {
		return genResult{}, fmt.Errorf("%s", errMsg)
	}
	p = resolved

	req := components.VideoGenerationRequest{
		Model:  modelID,
		Prompt: prompt,
	}

	// Frame anchors come from the DEDICATED first/last frame inputs. They
	// are independent of the multi-image `ref` field — the form's first
	// and last slots are entirely separate from the reference list.
	if firstFrame != nil || lastFrame != nil {
		req.FrameImages = make([]components.FrameImage, 0, 2)
		if firstFrame != nil {
			req.FrameImages = append(req.FrameImages, components.FrameImage{
				Type:      components.FrameImageTypeImageURL,
				ImageURL:  components.FrameImageImageURL{URL: firstFrame.dataURL()},
				FrameType: components.FrameTypeFirstFrame,
			})
		}
		if lastFrame != nil {
			req.FrameImages = append(req.FrameImages, components.FrameImage{
				Type:      components.FrameImageTypeImageURL,
				ImageURL:  components.FrameImageImageURL{URL: lastFrame.dataURL()},
				FrameType: components.FrameTypeLastFrame,
			})
		}
	}

	// Reference images (up to 16) go to InputReferences using the union helper.
	// They are visual guides, NOT frame anchors.
	if len(refs) > 0 {
		req.InputReferences = make([]components.InputReference, 0, len(refs))
		for _, ref := range refs {
			img := components.ContentPartImage{
				ImageURL: components.ContentPartImageImageURL{URL: ref.dataURL()},
			}
			req.InputReferences = append(req.InputReferences,
				components.CreateInputReferenceImageURL(img))
		}
	}

	// Optional params. Each helper returns nil for "blank", which the SDK
	// omits from the request body via `omitzero`.
	// Note: Size is mutually exclusive with AspectRatio + Resolution (validated
	// in applyVideoPolicy), so at most one of these is non-empty here.
	if p.Size != "" {
		req.Size = &p.Size
	} else {
		if v := p.AspectRatio; v != "" {
			req.AspectRatio = (*components.VideoGenerationRequestAspectRatio)(&v)
		}
		if v := p.Resolution; v != "" {
			req.Resolution = (*components.VideoGenerationRequestResolution)(&v)
		}
	}
	req.Duration = int64Ptr(p.Duration)
	req.GenerateAudio = boolPtr(p.GenerateAudio)
	req.Seed = int64Ptr(p.Seed)

	logVideoRequest(req)

	// Submit job
	submit, err := client.VideoGeneration.Generate(ctx, req, operations.WithOperationTimeout(2*time.Minute))
	if err != nil {
		return genResult{}, fmt.Errorf("submit: %w", err)
	}
	if submit == nil {
		return genResult{}, fmt.Errorf("submit returned nil response")
	}

	jobID := submit.GetID()
	if jobID == "" {
		return genResult{}, fmt.Errorf("submit returned empty job id")
	}

	// Poll until done. We log to stderr so the user can watch progress if they
	// have the terminal open.
	fmt.Fprintf(os.Stderr, "video job submitted: %s (status=%s)\n", jobID, submit.GetStatus())
	deadline := time.Now().Add(videoTimeoutMax)
	for {
		if time.Now().After(deadline) {
			return genResult{}, fmt.Errorf("video generation timed out after %s", videoTimeoutMax)
		}
		select {
		case <-ctx.Done():
			return genResult{}, ctx.Err()
		case <-time.After(videoPollEvery):
		}

		status, err := client.VideoGeneration.GetGeneration(ctx, jobID, operations.WithOperationTimeout(30*time.Second))
		if err != nil {
			fmt.Fprintf(os.Stderr, "poll error (will retry): %v\n", err)
			continue
		}
		fmt.Fprintf(os.Stderr, "video job %s: status=%s\n", jobID, status.GetStatus())

		switch status.GetStatus() {
		case components.VideoGenerationResponseStatusCompleted:
			urls := status.GetUnsignedUrls()
			if len(urls) == 0 {
				return genResult{}, fmt.Errorf("completed but no urls in response")
			}
			if len(urls) > 1 {
				// Today we only save the first variant. If a provider ever
				// starts returning multiple resolutions/encodings, we'll
				// want to keep all of them — but for now, surface it loudly
				// so we know to revisit this.
				fmt.Fprintf(os.Stderr, "warning: video job %s returned %d urls; saving only urls[0]\n", jobID, len(urls))
			}
			// Stream the video directly to disk. We never load the whole
			// body into RAM, and downloadVideo enforces a hard size cap
			// (500 MiB by default) and sniffs the real file extension
			// from the CDN's Content-Type + magic bytes.
			tmpPath, ext, err := downloadVideo(ctx, urls[0])
			if err != nil {
				return genResult{}, fmt.Errorf("download video: %w", err)
			}
			// Hand the temp file to saveOutput, which will move it into
			// outputDir under its final, timestamped name. The bytes-on-disk
			// path is much cheaper than re-reading the file.
			savedName, saveErr := saveOutputFromFile(outputDir, "video", modelID, ext, tmpPath)
			if saveErr != nil {
				_ = os.Remove(tmpPath)
				return genResult{}, fmt.Errorf("save video: %w", saveErr)
			}
			return genResult{ext: ext, data: nil, path: savedName}, nil
		case components.VideoGenerationResponseStatusFailed,
			components.VideoGenerationResponseStatusCancelled,
			components.VideoGenerationResponseStatusExpired:
			msg := status.GetError()
			if msg == nil {
				s := string(status.GetStatus())
				msg = &s
			}
			return genResult{}, fmt.Errorf("video job %s: %s", status.GetStatus(), *msg)
		}
		// pending / in_progress -> poll again
	}
}

// downloadVideo streams the pre-signed video URL directly into a file on
// disk, applying size and content-type guards along the way. It replaces
// the old `downloadFile` that read everything into a []byte — videos can
// be tens to hundreds of MB and there's no reason to hold them in RAM.
//
// Returns the temp file path (caller is responsible for moving it into
// outputDir via saveOutput) and the sniffed file extension ("mp4",
// "webm", "mov", ...). The extension is derived from the response's
// Content-Type first, then from the first few bytes if that's missing.
func downloadVideo(ctx context.Context, url string) (tmpPath string, ext string, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return "", "", fmt.Errorf("download %s: HTTP %d", url, resp.StatusCode)
	}

	// Fast-fail on declared Content-Length. A missing/zero header just
	// means we can't precheck — we'll still cap via the counting reader.
	if resp.ContentLength > maxDownloadBytes {
		return "", "", fmt.Errorf("download %s: Content-Length %d exceeds limit %d", url, resp.ContentLength, maxDownloadBytes)
	}

	// Create a temp file in the OS temp dir. We don't put it in outputDir
	// because (a) the file extension may change after we sniff the bytes,
	// and (b) keeping it in a temp dir means a partial download doesn't
	// show up in the user's ai_outputs/ folder.
	f, err := os.CreateTemp("", "studio-dl-*.bin")
	if err != nil {
		return "", "", err
	}
	tmpPath = f.Name()
	// On any error path we want the temp file removed.
	cleanup := func() {
		_ = f.Close()
		_ = os.Remove(tmpPath)
	}

	// Wrap the body in a counting reader so we can enforce the cap even
	// when the server didn't send Content-Length.
	limited := io.LimitReader(resp.Body, maxDownloadBytes+1)
	n, err := io.Copy(f, limited)
	if err != nil {
		cleanup()
		return "", "", fmt.Errorf("download %s: %w", url, err)
	}
	if n > maxDownloadBytes {
		cleanup()
		return "", "", fmt.Errorf("download %s: response exceeded size limit (%d bytes)", url, maxDownloadBytes)
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return "", "", err
	}

	// Sniff the extension. Prefer the server's Content-Type (CDN knows
	// best) and fall back to magic-byte inspection of the file we just
	// wrote.
	ext = extFromContentType(resp.Header.Get("Content-Type"))
	if ext == "" {
		ext = sniffVideoExt(tmpPath)
	}
	if ext == "" {
		// Last-resort default. If a model ever returns a video format we
		// don't recognize, the file is still saved and playable; only the
		// extension is a guess.
		ext = "mp4"
	}
	return tmpPath, ext, nil
}

// extFromContentType maps a Content-Type header value to a file extension.
// Returns "" if the type is missing or unrecognized.
func extFromContentType(ct string) string {
	ct = strings.TrimSpace(strings.SplitN(ct, ";", 2)[0]) // strip "; charset=..."
	switch strings.ToLower(ct) {
	case "video/mp4", "application/mp4":
		return "mp4"
	case "video/webm":
		return "webm"
	case "video/quicktime":
		return "mov"
	case "video/x-matroska":
		return "mkv"
	case "video/x-msvideo":
		return "avi"
	case "image/gif":
		return "gif"
	}
	return ""
}

// sniffVideoExt peeks at the first few bytes of a file and returns the
// most likely video extension. We support the common containers a CDN
// would deliver. Returns "" if nothing matches.
func sniffVideoExt(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	// 16 bytes is enough for every container signature we care about.
	var head [16]byte
	if _, err := io.ReadFull(f, head[:]); err != nil {
		return ""
	}
	b := head[:]
	// ISO base media (mp4, mov, m4v, hevc, etc.) — "ftyp" at offset 4.
	if len(b) >= 8 && b[4] == 'f' && b[5] == 't' && b[6] == 'y' && b[7] == 'p' {
		// Distinguish mp4 vs mov by the major brand after "ftyp".
		brand := string(b[8:12])
		switch brand {
		case "qt  ", "qtif":
			return "mov"
		default:
			return "mp4"
		}
	}
	// Matroska / WebM — EBML header (0x1A 0x45 0xDF 0xA3).
	if len(b) >= 4 && b[0] == 0x1A && b[1] == 0x45 && b[2] == 0xDF && b[3] == 0xA3 {
		// We can't cheaply tell webm from mkv without parsing the
		// DocType element. Default to webm since it's by far the more
		// common one for browser-playable video.
		return "webm"
	}
	// RIFF (AVI / WebM-old) — "RIFF" .... "AVI " / "WEBM".
	if len(b) >= 12 && string(b[0:4]) == "RIFF" && string(b[8:12]) == "AVI " {
		return "avi"
	}
	// GIF87a / GIF89a — sometimes a model returns a "video" that's a GIF.
	if len(b) >= 4 && (string(b[0:4]) == "GIF8" || string(b[0:3]) == "GIF") {
		return "gif"
	}
	return ""
}

// sniffImageExt returns the canonical file extension for a decoded image,
// or "" if the bytes don't look like a known image format.
func sniffImageExt(b []byte) string {
	if len(b) >= 8 && string(b[0:8]) == "\x89PNG\r\n\x1a\n" {
		return "png"
	}
	if len(b) >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF {
		return "jpg"
	}
	if len(b) >= 12 && string(b[0:4]) == "RIFF" && string(b[8:12]) == "WEBP" {
		return "webp"
	}
	if len(b) >= 5 && (string(b[0:5]) == "<svg " || string(b[0:5]) == "<?xml") {
		return "svg"
	}
	if len(b) >= 6 && (string(b[0:6]) == "GIF87a" || string(b[0:6]) == "GIF89a") {
		return "gif"
	}
	return ""
}
