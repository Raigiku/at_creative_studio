package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
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
//  4. built-in defaults  (used only if every above is missing — and on
//     first run we *write* the defaults back to (2) so the user can see
//     the format and edit it)
//
// The file format is documented in the default models.yaml written on
// first run. Each entry has an `id`, an optional `name`, and an optional
// `capabilities` block that drives the form's field visibility,
// dropdown options, and cross-field validation. Entries without a
// `capabilities` block fall back to the static HTML defaults on the
// client (every field enabled, FIELD_FALLBACKS for enum values).
func loadModels() modelLists {
	defaults := defaultModels()

	path, err := resolveModelsPath()
	if err != nil || path == "" {
		fmt.Fprintln(os.Stderr, "note: no models.yaml found; using built-in defaults.")
		return defaults
	}

	loaded, err := parseModelsYAML(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: failed to parse %s: %v\n", path, err)
		fmt.Fprintln(os.Stderr, "  Falling back to built-in defaults. Edit the file and restart.")
		return defaults
	}
	if loaded.Image == nil && loaded.Video == nil {
		return defaults
	}
	fmt.Fprintf(os.Stderr, "Loaded models from %s\n", path)
	return loaded
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

// defaultModels is the curated list we ship with. Every entry has its
// capabilities fully filled in so a fresh install works without any
// network calls.
func defaultModels() modelLists {
	return modelLists{
		Image: []modelEntry{
			{
				ID:   "x-ai/grok-imagine-image-quality",
				Name: "Grok Imagine (Image) — quality",
				Capabilities: &capabilities{
					Fields: map[string]fieldCap{
						"resolution":       {Enabled: true, Type: "enum", Values: []string{"1K", "2K"}},
						"aspect_ratio":     {Enabled: true, Type: "enum", Values: []string{"1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "9:19.5", "19.5:9", "9:20", "20:9", "1:2", "2:1", "auto"}},
						"n":                {Enabled: true, Type: "range", Min: floatPtr(1), Max: floatPtr(1)},
						"input_references": {Enabled: true, Type: "range", Min: floatPtr(0), Max: floatPtr(3)},
					},
				},
			},
			{
				ID:   "openai/gpt-image-2",
				Name: "OpenAI GPT Image 2",
				Capabilities: &capabilities{
					Fields: map[string]fieldCap{
						"output_format":      {Enabled: true, Type: "enum", Values: []string{"png", "jpeg", "webp"}},
						"output_compression": {Enabled: true, Type: "range", Min: floatPtr(0), Max: floatPtr(100)},
						"quality":            {Enabled: true, Type: "enum", Values: []string{"auto", "low", "medium", "high"}},
						"background":         {Enabled: true, Type: "enum", Values: []string{"auto", "opaque"}},
						"n":                  {Enabled: true, Type: "range", Min: floatPtr(1), Max: floatPtr(10)},
						"input_references":   {Enabled: true, Type: "range", Min: floatPtr(0), Max: floatPtr(16)},
						"resolution":         {Enabled: false},
					},
					Constraints: []constraint{
						{
							IfSet: "output_compression",
							Requires: constraintNeed{
								Field: "output_format",
								In:    []string{"jpeg", "webp"},
							},
							Message: "this model only applies output_compression when output_format is jpeg or webp. " +
								"Either switch the output format, or unset output_compression.",
						},
					},
				},
			},
		},
		Video: []modelEntry{
			{
				ID:   "bytedance/seedance-2.0",
				Name: "Seedance 2.0 — video",
				Capabilities: &capabilities{
					Fields: map[string]fieldCap{
						"aspect_ratio": {Enabled: true, Type: "enum", Values: []string{"1:1", "3:4", "9:16", "4:3", "16:9", "21:9", "9:21"}},
						"duration":     {Enabled: true, Type: "enum", Values: []string{"4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"}},
						"resolution":   {Enabled: true, Type: "enum", Values: []string{"480p", "720p", "1080p", "4K"}},
						"size":         {Enabled: true, Type: "enum", Values: []string{
							"480x480", "480x640", "480x854", "640x480", "854x480", "1120x480",
							"720x720", "720x960", "720x1280", "720x1680", "960x720", "1280x720", "1680x720",
							"1080x1080", "1080x1440", "1080x1920", "1440x1080", "1920x1080",
							"2520x1080", "3840x2160", "2160x3840", "2160x2160", "2880x2160", "2160x2880", "5040x2160",
						}},
						"frame_first":    {Enabled: true, Type: "boolean"},
						"frame_last":     {Enabled: true, Type: "boolean"},
						"generate_audio": {Enabled: true, Type: "boolean"},
						"seed":           {Enabled: true, Type: "range", Min: floatPtr(0), Max: floatPtr(999999)},
					},
				},
			},
			{
				ID:   "x-ai/grok-imagine-video",
				Name: "Grok Imagine — video",
				Capabilities: &capabilities{
					Fields: map[string]fieldCap{
						"aspect_ratio": {Enabled: true, Type: "enum", Values: []string{"16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"}},
						"duration":     {Enabled: true, Type: "enum", Values: []string{"1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"}},
						"resolution":   {Enabled: true, Type: "enum", Values: []string{"480p", "720p"}},
						"size":         {Enabled: true, Type: "enum", Values: []string{
							"854x480", "1280x720", "480x854", "720x1280", "480x480", "720x720",
							"640x480", "960x720", "480x640", "720x960",
							"720x480", "1080x720", "480x720", "720x1080",
						}},
						"frame_first":    {Enabled: true, Type: "boolean"},
						"frame_last":     {Enabled: false},
						"generate_audio": {Enabled: false},
						"seed":           {Enabled: false},
					},
				},
			},
			{
				ID:   "google/veo-3.1-lite",
				Name: "Veo 3.1 Lite — video",
				Capabilities: &capabilities{
					Fields: map[string]fieldCap{
						"aspect_ratio": {Enabled: true, Type: "enum", Values: []string{"16:9", "9:16"}},
						"duration":     {Enabled: true, Type: "enum", Values: []string{"4", "6", "8"}},
						"resolution":   {Enabled: true, Type: "enum", Values: []string{"720p", "1080p"}},
						"size":         {Enabled: true, Type: "enum", Values: []string{"1280x720", "720x1280", "1920x1080", "1080x1920"}},
						"frame_first":    {Enabled: true, Type: "boolean"},
						"frame_last":     {Enabled: true, Type: "boolean"},
						"generate_audio": {Enabled: true, Type: "boolean"},
						"seed":           {Enabled: true, Type: "range", Min: floatPtr(0), Max: floatPtr(999999)},
					},
				},
			},
		},
	}
}

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

// resolveModelsPath determines which models.yaml to use. Returns ("", nil)
// if no candidate file exists (the caller should fall back to defaults).
// If a file doesn't exist but we know where it would go, we *create* it
// with the default contents so the user can immediately see the format.
func resolveModelsPath() (string, error) {
	candidates := modelsYAMLCandidates()
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
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

// ----- writer -----

// writeDefaultModelsYAML writes a commented default models.yaml to the
// given path. We write the comments manually (yaml.v3's Marshaler can't
// emit them) so the user can see the format and what's customizable.
func writeDefaultModelsYAML(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	d := defaultModels()
	var b strings.Builder
	b.WriteString("# Creative Studio — model list and per-model UI config\n")
	b.WriteString("#\n")
	b.WriteString("# Edit this file to add or remove models, or to change what the\n")
	b.WriteString("# form looks like for each model. Restart studio.exe after editing.\n")
	b.WriteString("#\n")
	b.WriteString("# Each entry needs:\n")
	b.WriteString("#   id:    the OpenRouter model identifier (required)\n")
	b.WriteString("#   name:  what's shown in the dropdown (optional, defaults to id)\n")
	b.WriteString("#\n")
	b.WriteString("# Each entry MAY have a `capabilities` block. If absent, the form\n")
	b.WriteString("# uses the static HTML defaults (every field enabled, all options\n")
	b.WriteString("# available). When present, the block controls:\n")
	b.WriteString("#\n")
	b.WriteString("#   fields:       a map of form-field name → UI config\n")
	b.WriteString("#     enabled:    whether the field is shown and editable\n")
	b.WriteString("#     type:       \"enum\" (dropdown), \"range\" (number input),\n")
	b.WriteString("#                 \"text\" (free-form), or \"boolean\" (checkbox)\n")
	b.WriteString("#     values:     (enum only) the allowed options\n")
	b.WriteString("#     min, max:   (range only) the inclusive bounds\n")
	b.WriteString("#\n")
	b.WriteString("#   constraints:  cross-field rules. Each rule says: \"if `if_set`\n")
	b.WriteString("#                 has a non-zero value, then `requires.field` must\n")
	b.WriteString("#                 be in `requires.in`.\" The server enforces this on\n")
	b.WriteString("#                 submit; the UI uses it to narrow dropdown options\n")
	b.WriteString("#                 and auto-correct invalid combinations.\n")
	b.WriteString("#\n")
	b.WriteString("# Example: add a new image model by appending a new bullet under\n")
	b.WriteString("# `image:`. If you don't add a `capabilities` block, the form will\n")
	b.WriteString("# use the static defaults.\n")
	b.WriteString("\n")
	b.WriteString("image:\n")
	for _, m := range d.Image {
		writeYAMLEntry(&b, "  ", m, "image")
	}
	b.WriteString("\nvideo:\n")
	for _, m := range d.Video {
		writeYAMLEntry(&b, "  ", m, "video")
	}
	b.WriteString("\n")
	return os.WriteFile(path, []byte(b.String()), 0o644)
}

// writeYAMLEntry writes one model entry, including the capabilities
// block if present. The block is written by hand because we want
// per-field comments and ordered keys; yaml.Marshal doesn't preserve
// our ordering and would emit values for empty fields.
func writeYAMLEntry(b *strings.Builder, indent string, m modelEntry, section string) {
	fmt.Fprintf(b, "%s- id: %q\n", indent, m.ID)
	if m.Name != "" && m.Name != m.ID {
		fmt.Fprintf(b, "%s  name: %q\n", indent, m.Name)
	}
	if m.Capabilities == nil {
		return
	}
	b.WriteString(indent + "  capabilities:\n")
	if len(m.Capabilities.Fields) > 0 {
		b.WriteString(indent + "    fields:\n")
		// Sort field names for stable output. This also makes the
		// generated file easier to diff against a hand-edited one.
		names := make([]string, 0, len(m.Capabilities.Fields))
		for k := range m.Capabilities.Fields {
			names = append(names, k)
		}
		sort.Strings(names)
		for _, name := range names {
			fc := m.Capabilities.Fields[name]
			writeFieldCap(b, indent+"      ", name, fc)
		}
	}
	if len(m.Capabilities.Constraints) > 0 {
		b.WriteString(indent + "    constraints:\n")
		for _, c := range m.Capabilities.Constraints {
			writeConstraint(b, indent+"      ", c)
		}
	}
}

func writeFieldCap(b *strings.Builder, indent, name string, fc fieldCap) {
	fmt.Fprintf(b, "%s%s:\n", indent, name)
	fmt.Fprintf(b, "%s  enabled: %t\n", indent, fc.Enabled)
	if fc.Type != "" {
		fmt.Fprintf(b, "%s  type: %q\n", indent, fc.Type)
	}
	if len(fc.Values) > 0 {
		b.WriteString(indent + "  values: [")
		for i, v := range fc.Values {
			if i > 0 {
				b.WriteString(", ")
			}
			fmt.Fprintf(b, "%q", v)
		}
		b.WriteString("]\n")
	}
	if fc.Min != nil {
		fmt.Fprintf(b, "%s  min: %s\n", indent, formatFloat(*fc.Min))
	}
	if fc.Max != nil {
		fmt.Fprintf(b, "%s  max: %s\n", indent, formatFloat(*fc.Max))
	}
}

func writeConstraint(b *strings.Builder, indent string, c constraint) {
	b.WriteString(indent + "- if_set: " + c.IfSet + "\n")
	b.WriteString(indent + "  requires:\n")
	fmt.Fprintf(b, "%s    field: %q\n", indent, c.Requires.Field)
	b.WriteString(indent + "    in: [")
	for i, v := range c.Requires.In {
		if i > 0 {
			b.WriteString(", ")
		}
		fmt.Fprintf(b, "%q", v)
	}
	b.WriteString("]\n")
	if c.Message != "" {
		fmt.Fprintf(b, "%s  message: %q\n", indent, c.Message)
	}
}

// formatFloat prints a float64 the way a hand-written YAML would:
// integers without a trailing `.0`, fractional values with full
// precision. yaml.v3 always emits `1.0` for an integer float, which
// looks off in a config file.
func formatFloat(f float64) string {
	if f == float64(int64(f)) {
		return fmt.Sprintf("%d", int64(f))
	}
	return fmt.Sprintf("%g", f)
}
