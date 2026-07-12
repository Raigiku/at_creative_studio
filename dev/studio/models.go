package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// loadModels returns the list of image and video models exposed in the UI.
//
// The list is read from a YAML file. The path is resolved in this order:
//
//  1. $STUDIO_MODELS env var (absolute or relative to CWD)
//  2. <binaryDir>/models.yaml  (same directory as the running executable)
//  3. <repoRoot>/dev/studio/models.yaml  (source-tree fallback for `go run`)
//
// The server fails fast when models.yaml is missing or unparseable
// — there is no built-in default list. A checked-in
// models.example.yaml ships in the repo as a starting point; the
// user copies it to models.yaml and customises.
//
// The file format is documented in models.example.yaml. Each entry
// has an `id`, an optional `name`, and an optional `capabilities`
// block that drives the form's field visibility, dropdown options,
// and cross-field validation. Entries without a `capabilities`
// block fall back to the static HTML defaults on the client (every
// field enabled, FIELD_FALLBACKS for enum values).
func loadModels() (modelLists, error) {
	path, err := resolveModelsPath()
	if err != nil || path == "" {
		return modelLists{}, fmt.Errorf(
			"no models.yaml found. Copy models.example.yaml to models.yaml and edit it, " +
				"or set $STUDIO_MODELS to an existing file.\n" +
				"  Searched: %s", strings.Join(modelsYAMLCandidates(), ", "))
	}
	loaded, err := parseModelsYAML(path)
	if err != nil {
		return modelLists{}, fmt.Errorf("failed to parse %s: %w", path, err)
	}
	if loaded.Image == nil && loaded.Video == nil {
		return modelLists{}, fmt.Errorf("%s parsed but contains no models — add at least one entry under `image:` or `video:`", path)
	}
	fmt.Fprintf(os.Stderr, "Loaded models from %s\n", path)
	return loaded, nil
}

// ----- YAML schema -----

// modelsYAML is the on-disk shape. We parse everything in one pass; the
// Capabilities field is the per-model UI block. nil means "no entry";
// the UI distinguishes that from "explicit empty" by checking nil.
type modelsYAML struct {
	Image []modelYAMLEntry `yaml:"image"`
	Video []modelYAMLEntry `yaml:"video"`
}

type modelYAMLEntry struct {
	ID           string       `yaml:"id"`
	Name         string       `yaml:"name"`
	Capabilities *capabilities `yaml:"capabilities,omitempty"`
}

// capabilities is one model's UI contract: which form fields exist,
// which are enabled, what values they take, and what cross-field rules
// apply. Mirrored 1:1 in JSON for the /api/models/{id} endpoint.
//
// The JSON keys are lowercase to match what the UI reads. The
// yaml tags keep the camelCase the user types in models.yaml.
type capabilities struct {
	Fields      map[string]fieldCap `json:"fields,omitempty" yaml:"fields,omitempty"`
	Constraints []constraint        `json:"constraints,omitempty" yaml:"constraints,omitempty"`
}

// fieldCap is the per-field UI shape. The kind-specific fields (Values
// for enum, Min/Max for range) are pointers or nil so the JSON omits
// them when not relevant. JSON keys are lowercase to match the UI.
type fieldCap struct {
	Enabled bool     `json:"enabled" yaml:"enabled"`
	Type    string   `json:"type,omitempty"    yaml:"type"` // "enum" | "range" | "text" | "boolean"
	Values  []string `json:"values,omitempty"  yaml:"values,omitempty"`
	Min     *float64 `json:"min,omitempty"     yaml:"min,omitempty"`
	Max     *float64 `json:"max,omitempty"     yaml:"max,omitempty"`
}

// constraint is a single cross-field rule. The supported shape is:
//
//	if_set: <fieldname>
//	requires:
//	  field: <fieldname>
//	  in:    [<value1>, <value2>, ...]
//	message: "human-readable explanation"
//
// When a request has a non-zero value in `if_set`, the rule fires
// unless `requires.field`'s current value is in `requires.in`. The
// server enforces this on submit; the UI uses the same data to narrow
// dropdown options and auto-correct invalid combinations.
//
// JSON keys are lowercase to match the UI contract.
type constraint struct {
	IfSet    string         `json:"if_set"    yaml:"if_set"`
	Requires constraintNeed `json:"requires"  yaml:"requires"`
	Message  string         `json:"message,omitempty" yaml:"message"`
}

type constraintNeed struct {
	Field string   `json:"field" yaml:"field"`
	In    []string `json:"in"    yaml:"in"`
}

// ----- parsing -----

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
	// Default absent Capabilities to nil. yaml.Unmarshal leaves it nil
	// for entries that omit the block, which is exactly what we want.
	return out, nil
}

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
		entry := modelEntry{ID: id, Name: name}
		// Capabilities is a pointer so we can distinguish "no block"
		// from "block with no fields". An entry with an empty
		// `capabilities:` block parses to &capabilities{} (not nil) —
		// the UI treats that the same as nil today, but the
		// distinction is preserved in case we want to differentiate
		// later (e.g. "explicitly disable every field").
		if e.Capabilities != nil {
			entry.Capabilities = e.Capabilities
		}
		out = append(out, entry)
	}
	return out
}

// ----- defaults -----
//
// There are no built-in defaults. The server requires a models.yaml
// on disk and fails fast if it's missing or unparseable. The
// models.example.yaml checked into the repo is the starting point.

func floatPtr(f float64) *float64 { return &f }

// refImagesMaxForModel returns the per-model cap on reference images,
// read from the in-memory modelLists. Looks up the model by id; if it
// has an `input_references` range field in its capabilities block,
// the cap is the field's max. If the model is unknown, has no
// capabilities block, or has no `input_references` field, falls back
// to maxReferenceImages (the package-level constant in config.go).
//
// We floor the cap to [0, maxReferenceImages] so a misbehaving
// models.yaml can't bypass the server's hard upper bound.
func refImagesMaxForModel(lists modelLists, modelID string) int {
	entry := findModelEntry(lists, modelID)
	if entry == nil || entry.Capabilities == nil {
		return maxReferenceImages
	}
	fc, ok := entry.Capabilities.Fields["input_references"]
	if !ok || fc.Type != "range" || fc.Max == nil {
		return maxReferenceImages
	}
	max := int(*fc.Max)
	if max < 0 {
		return maxReferenceImages
	}
	if max > maxReferenceImages {
		return maxReferenceImages
	}
	return max
}

// applyCapabilitiesConstraints enforces the per-model constraints
// declared in models.yaml. Returns the first violated rule's message
// (suitable for an HTTP 400 body), or "" if every rule passes.
//
// A constraint fires when its `if_set` field has a non-zero value
// AND its `requires.field` is not in `requires.in`. Field names in
// the YAML match the genParams field names exactly. The lookup of
// each field's current value is a small dispatch table below —
// keep it in sync with genParams in params.go.
func applyCapabilitiesConstraints(lists modelLists, modelID string, p genParams) string {
	entry := findModelEntry(lists, modelID)
	if entry == nil || entry.Capabilities == nil {
		return ""
	}
	for _, c := range entry.Capabilities.Constraints {
		if !constraintFires(c, p) {
			continue
		}
		return c.Message
	}
	return ""
}

// constraintFires reports whether the constraint's condition is met
// (if_set is non-zero) AND the consequent is violated (requires.field
// is not in requires.in). Comparison is case-insensitive for string
// fields, exact for ints, so jpg/jpeg equivalence works.
func constraintFires(c constraint, p genParams) bool {
	if !fieldIsSet(c.IfSet, p) {
		return false
	}
	current := fieldStringValue(c.Requires.Field, p)
	if current == "" {
		// Required field has no value at all → not in the allowed
		// set (which is non-empty by construction). Violation.
		return true
	}
	currentLower := strings.ToLower(current)
	for _, allowed := range c.Requires.In {
		if strings.ToLower(allowed) == currentLower {
			return false
		}
	}
	return true
}

// fieldIsSet reports whether the named genParams field is "non-zero"
// — non-empty string or non-zero int. Boolean fields are always
// "set" if true (we never encode booleans in constraints today, but
// the dispatch table is the same shape).
func fieldIsSet(name string, p genParams) bool {
	v := fieldStringValue(name, p)
	if v != "" {
		return true
	}
	return fieldIntValue(name, p) != 0
}

// fieldStringValue returns the named genParams field as a string.
// Boolean true becomes "true"; false becomes "". Unknown names
// return "".
func fieldStringValue(name string, p genParams) string {
	switch name {
	case "aspect_ratio":
		return p.AspectRatio
	case "background":
		return p.Background
	case "output_format":
		return p.OutputFormat
	case "quality":
		return p.Quality
	case "resolution":
		return p.Resolution
	case "size":
		return p.Size
	case "n":
		if p.N == 0 {
			return ""
		}
		return fmt.Sprintf("%d", p.N)
	case "output_compression":
		if p.OutputCompression == 0 {
			return ""
		}
		return fmt.Sprintf("%d", p.OutputCompression)
	case "seed":
		if p.Seed == 0 {
			return ""
		}
		return fmt.Sprintf("%d", p.Seed)
	case "duration":
		if p.Duration == 0 {
			return ""
		}
		return fmt.Sprintf("%d", p.Duration)
	case "generate_audio":
		if p.GenerateAudio {
			return "true"
		}
		return ""
	}
	return ""
}

// fieldIntValue returns the named genParams field as an int. Used
// only to treat integer fields as "set" for constraint evaluation.
// Unknown names return 0.
func fieldIntValue(name string, p genParams) int {
	switch name {
	case "n":
		return p.N
	case "output_compression":
		return p.OutputCompression
	case "seed":
		return p.Seed
	case "duration":
		return p.Duration
	}
	return 0
}

// ----- path resolution -----

// resolveModelsPath determines which models.yaml to use. Returns
// ("", nil) if no candidate file exists — the caller surfaces that
// as a startup error pointing the user at models.example.yaml.
func resolveModelsPath() (string, error) {
	candidates := modelsYAMLCandidates()
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", nil
}

func modelsYAMLCandidates() []string {
	var out []string
	if env := strings.TrimSpace(os.Getenv("STUDIO_MODELS")); env != "" {
		out = append(out, filepath.Clean(env))
	}
	if exe, err := os.Executable(); err == nil {
		out = append(out, filepath.Join(filepath.Dir(exe), "models.yaml"))
	}
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

// (end of models.go — no built-in defaults; the YAML file is the
// only source of truth for the model list)

