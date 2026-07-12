package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	openrouter "github.com/OpenRouterTeam/go-sdk"
	"gopkg.in/yaml.v3"
)

// loadModels returns the list of image and video models exposed in the UI.
//
// The list is read from a YAML file. The path is resolved in this order:
//
//  1. $STUDIO_MODELS env var (absolute or relative to CWD)
//  2. <binaryDir>/models.yaml  (same directory as the running executable)
//  3. <repoRoot>/dev/studio/models.yaml  (source-tree fallback for `go run`)
//  4. built-in defaults  (used only if every above is missing — and on
//     first run we *write* the defaults back to (2) so the user can see
//     the format and edit it)
//
// The file format is:
//
//	image:
//	  - id: x-ai/grok-imagine-image-quality
//	    name: Grok Imagine (Image) — quality
//	video:
//	  - id: bytedance/seedance-2.0
//	    name: Seedance 2.0 — video
//
// `id` is required; `name` is optional and defaults to `id`. Comments and
// blank lines are allowed.
func loadModels(ctx context.Context, client *openrouter.OpenRouter) modelLists {
	// Built-in defaults used as a last-resort fallback AND written out
	// on first run so the user has a model.yaml to edit.
	defaults := defaultModels()

	// Best-effort: confirm the API key works. We don't currently rewrite the
	// curated list with the live one because the full list is hundreds of
	// entries and most aren't relevant.
	if resp, err := client.Models.List(ctx, nil); err == nil && resp != nil {
		_ = resp
	} else if err != nil {
		fmt.Fprintln(os.Stderr, "warning: could not verify API key via /models:", err)
	}

	// Try to load from the YAML config file.
	path, err := resolveModelsPath()
	if err != nil || path == "" {
		// No path resolved; use defaults and move on.
		fmt.Fprintln(os.Stderr, "note: no models.yaml found; using built-in defaults.")
		return defaults
	}

	loaded, err := parseModelsYAML(path)
	if err != nil {
		// Config file exists but is broken — surface the error loudly so the
		// user fixes it. Fall back to defaults so the server still works.
		fmt.Fprintf(os.Stderr, "ERROR: failed to parse %s: %v\n", path, err)
		fmt.Fprintln(os.Stderr, "  Falling back to built-in defaults. Edit the file and restart.")
		return defaults
	}
	if loaded.Image == nil && loaded.Video == nil {
		// File was empty / had no recognized sections. Treat as "no models".
		return defaults
	}
	fmt.Fprintf(os.Stderr, "Loaded models from %s\n", path)
	return loaded
}

// modelsYAML is the on-disk schema. We only expose `id` and `name`; the
// id is the OpenRouter model identifier and name is what's shown in the
// dropdown. The shape is intentionally simple so a user can edit it in
// any text editor without learning the OpenRouter SDK.
type modelsYAML struct {
	Image []modelYAMLEntry `yaml:"image"`
	Video []modelYAMLEntry `yaml:"video"`
}

type modelYAMLEntry struct {
	ID   string `yaml:"id"`
	Name string `yaml:"name"`
}

// defaultModels is the curated list we ship with. It is the same content
// the server used before the YAML config was introduced, so upgrading
// users see no behavior change on day one.
func defaultModels() modelLists {
	return modelLists{
		Image: []modelEntry{
			{ID: "x-ai/grok-imagine-image-quality", Name: "Grok Imagine (Image) — quality"},
		},
		Video: []modelEntry{
			{ID: "bytedance/seedance-2.0", Name: "Seedance 2.0 — video"},
			{ID: "x-ai/grok-imagine-video", Name: "Grok Imagine — video"},
			{ID: "google/veo-3.1-lite", Name: "Veo 3.1 Lite — video"},
		},
	}
}

// resolveModelsPath determines which models.yaml to use. Returns ("", nil)
// if no candidate file exists (the caller should fall back to defaults).
// If a file doesn't exist but we know where it would go, we *create* it
// with the default contents so the user can immediately see the format.
func resolveModelsPath() (string, error) {
	candidates := modelsYAMLCandidates()
	// First existing candidate wins.
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	// None exist. Try to create one at the preferred location (binaryDir)
	// so the user has a discoverable file. We don't fail the server on
	// write errors here — just log.
	if len(candidates) > 0 {
		preferred := candidates[0]
		if err := writeDefaultModelsYAML(preferred); err != nil {
			fmt.Fprintf(os.Stderr, "warning: could not write default %s: %v\n", preferred, err)
		} else {
			fmt.Fprintf(os.Stderr, "Wrote default models to %s — edit it and restart to customize.\n", preferred)
		}
	}
	return "", nil
}

// modelsYAMLCandidates returns candidate paths in priority order:
//
//  1. $STUDIO_MODELS env var (if set)
//  2. <binaryDir>/models.yaml
//  3. <repoRoot>/dev/studio/models.yaml
func modelsYAMLCandidates() []string {
	var out []string
	if env := strings.TrimSpace(os.Getenv("STUDIO_MODELS")); env != "" {
		out = append(out, filepath.Clean(env))
	}
	if exe, err := os.Executable(); err == nil {
		out = append(out, filepath.Join(filepath.Dir(exe), "models.yaml"))
	}
	// Source-tree fallback: walk up to find the workspace root and use
	// dev/studio/models.yaml there. This makes `go run .` from a source
	// checkout work without extra setup.
	if cwd, err := os.Getwd(); err == nil {
		dir := cwd
		for i := 0; i < 6; i++ {
			if _, err := os.Stat(filepath.Join(dir, "dev", "studio", "go.mod")); err == nil {
				out = append(out, filepath.Join(dir, "dev", "studio", "models.yaml"))
				break
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	return out
}

// parseModelsYAML reads a models config file, validates each entry, and
// converts it into the modelLists shape the rest of the code uses.
func parseModelsYAML(path string) (modelLists, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return modelLists{}, err
	}
	var raw modelsYAML
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return modelLists{}, fmt.Errorf("yaml parse: %w", err)
	}

	out := modelLists{
		Image: yamlEntriesToModelEntries(raw.Image, "image"),
		Video: yamlEntriesToModelEntries(raw.Video, "video"),
	}
	return out, nil
}

// yamlEntriesToModelEntries trims, validates and converts raw YAML entries.
// An entry without an id is silently dropped (with a warning) — a name
// alone is not useful since it can't be sent to the SDK.
func yamlEntriesToModelEntries(in []modelYAMLEntry, section string) []modelEntry {
	out := make([]modelEntry, 0, len(in))
	for i, e := range in {
		id := strings.TrimSpace(e.ID)
		if id == "" {
			fmt.Fprintf(os.Stderr, "warning: %s[%d] has empty id; skipping.\n", section, i)
			continue
		}
		name := strings.TrimSpace(e.Name)
		if name == "" {
			name = id
		}
		out = append(out, modelEntry{ID: id, Name: name})
	}
	return out
}

// writeDefaultModelsYAML writes a commented default models.yaml to the
// given path. We write the comments manually (yaml.v3's Marshaler can't
// emit them) so the user can see the format and what's customizable.
func writeDefaultModelsYAML(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	d := defaultModels()
	var b strings.Builder
	b.WriteString("# Creative Studio — model list\n")
	b.WriteString("#\n")
	b.WriteString("# Edit this file to add or remove the models that show up in the\n")
	b.WriteString("# dropdown. Restart studio.exe after editing.\n")
	b.WriteString("#\n")
	b.WriteString("# Each entry needs an `id` (the OpenRouter model identifier) and\n")
	b.WriteString("# optionally a `name` (what's shown in the dropdown). If `name` is\n")
	b.WriteString("# omitted, the id is used as the name.\n")
	b.WriteString("#\n")
	b.WriteString("# Example: add a new image model by appending a new bullet under\n")
	b.WriteString("# `image:` — no need to touch any other file.\n")
	b.WriteString("\n")
	b.WriteString("image:\n")
	for _, m := range d.Image {
		fmt.Fprintf(&b, "  - id: %q\n    name: %q\n", m.ID, m.Name)
	}
	b.WriteString("\nvideo:\n")
	for _, m := range d.Video {
		fmt.Fprintf(&b, "  - id: %q\n    name: %q\n", m.ID, m.Name)
	}
	b.WriteString("\n")
	return os.WriteFile(path, []byte(b.String()), 0o644)
}
