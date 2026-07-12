package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// saveOutput writes data to outputDir using a self-describing filename:
//
//	<UTC timestamp>_<kind>_<sanitized-model>.<ext>
//
// e.g. 2026-07-11T143022Z_image_gemini-2.5-flash-image.png
// If a file with that name already exists, append _1, _2, ... to disambiguate.
// Returns the file name (no directory) for use in the response.
func saveOutput(outputDir, genType, modelID, ext string, data []byte) (string, error) {
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return "", fmt.Errorf("mkdir %s: %w", outputDir, err)
	}
	full, err := buildOutputPath(outputDir, genType, modelID, ext)
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(full, data, 0o644); err != nil {
		return "", err
	}
	return filepath.Base(full), nil
}

// saveOutputFromFile is the video-side counterpart of saveOutput. Instead
// of receiving bytes, it receives the path of a file already on disk
// (written by downloadVideo via os.CreateTemp) and renames it into
// outputDir under the same self-describing filename scheme. This avoids
// re-reading the video bytes just to copy them into the final location —
// the rename is the same on-disk operation on most filesystems.
//
// On any error after a successful CreateTemp, the caller is responsible
// for removing the temp file (we don't do that here because the caller
// owns the lifecycle).
func saveOutputFromFile(outputDir, genType, modelID, ext, srcPath string) (string, error) {
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return "", fmt.Errorf("mkdir %s: %w", outputDir, err)
	}
	dst, err := buildOutputPath(outputDir, genType, modelID, ext)
	if err != nil {
		return "", err
	}
	// os.Rename is atomic on the same filesystem and avoids a copy. If
	// the OS temp dir is on a different drive from outputDir (rare, but
	// happens on Windows with per-drive TEMP), the rename will fail with
	// "invalid cross-device link" or similar; in that case we fall back
	// to copy + delete, which is still cheaper than reading the whole
	// file into memory.
	if err := os.Rename(srcPath, dst); err != nil {
		if copyErr := copyFileAndRemove(srcPath, dst); copyErr != nil {
			return "", fmt.Errorf("move into output dir: rename failed (%v) and copy fallback failed (%v)", err, copyErr)
		}
	}
	return filepath.Base(dst), nil
}

// buildOutputPath constructs a self-describing filename and disambiguates
// collisions with a numeric suffix. It is shared by saveOutput and
// saveOutputFromFile so the two paths can never disagree on the scheme.
func buildOutputPath(outputDir, genType, modelID, ext string) (string, error) {
	ts := time.Now().UTC().Format("2006-01-02T150405Z")
	kind := "image"
	if genType == "t2v" || genType == "i2v" {
		kind = "video"
	}
	base := fmt.Sprintf("%s_%s_%s.%s", ts, kind, sanitizeForFilename(modelID), ext)
	full := filepath.Join(outputDir, base)
	if _, err := os.Stat(full); err == nil {
		// Timestamp collision (two generations in the same second). Disambiguate.
		for i := 1; i < 1000; i++ {
			candidate := fmt.Sprintf("%s_%s_%s_%d.%s", ts, kind, sanitizeForFilename(modelID), i, ext)
			candFull := filepath.Join(outputDir, candidate)
			if _, err := os.Stat(candFull); os.IsNotExist(err) {
				full = candFull
				break
			}
		}
	}
	return full, nil
}

// copyFileAndRemove is the cross-filesystem fallback for saveOutputFromFile.
// Streams src → dst with a 1 MiB buffer so we never hold the whole file
// in memory.
func copyFileAndRemove(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		_ = os.Remove(dst)
		return err
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(dst)
		return err
	}
	return os.Remove(src)
}

// sanitizeForFilename turns a model ID like "black-forest-labs/flux.2-pro" into
// "black-forest-labs-flux.2-pro" so it's safe across filesystems.
func sanitizeForFilename(s string) string {
	r := strings.NewReplacer("/", "-", "\\", "-", ":", "-", " ", "_")
	return r.Replace(s)
}
