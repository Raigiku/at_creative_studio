package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestParseModelsYAML_Capabilities pins down the on-disk schema for
// the capabilities block. We don't try to assert every field — we
// spot-check the contract the rest of the code depends on (pointer
// vs nil for absent blocks, the constraint shape, the float
// parsing).
func TestParseModelsYAML_Capabilities(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "models.yaml")
	yaml := `
image:
  - id: "openai/gpt-image-2"
    name: "OpenAI GPT Image 2"
    capabilities:
      fields:
        output_format:
          enabled: true
          type: "enum"
          values: [png, jpeg, webp]
        output_compression:
          enabled: true
          type: "range"
          min: 0
          max: 100
        resolution:
          enabled: false
      constraints:
        - if_set: output_compression
          requires:
            field: output_format
            in: [jpeg, webp]
          message: "this model only applies output_compression when output_format is jpeg or webp."

  - id: "no-cap-model"
    name: "No Capabilities"

video: []
`
	if err := os.WriteFile(path, []byte(yaml), 0o644); err != nil {
		t.Fatal(err)
	}

	lists, err := parseModelsYAML(path)
	if err != nil {
		t.Fatalf("parseModelsYAML: %v", err)
	}

	if got := len(lists.Image); got != 2 {
		t.Fatalf("Image len = %d, want 2", got)
	}

	gpt := lists.Image[0]
	if gpt.ID != "openai/gpt-image-2" {
		t.Errorf("gpt.ID = %q, want openai/gpt-image-2", gpt.ID)
	}
	if gpt.Capabilities == nil {
		t.Fatal("gpt.Capabilities = nil, want non-nil")
	}

	// Field with enum values: present, enabled, with values.
	fc := gpt.Capabilities.Fields["output_format"]
	if !fc.Enabled {
		t.Error("output_format Enabled = false, want true")
	}
	if fc.Type != "enum" {
		t.Errorf("output_format Type = %q, want enum", fc.Type)
	}
	if got, want := fc.Values, []string{"png", "jpeg", "webp"}; !equalStrings(got, want) {
		t.Errorf("output_format Values = %v, want %v", got, want)
	}

	// Range field: min/max parsed as float64 pointers.
	fc = gpt.Capabilities.Fields["output_compression"]
	if fc.Type != "range" {
		t.Errorf("output_compression Type = %q, want range", fc.Type)
	}
	if fc.Min == nil || *fc.Min != 0 {
		t.Errorf("output_compression Min = %v, want 0", fc.Min)
	}
	if fc.Max == nil || *fc.Max != 100 {
		t.Errorf("output_compression Max = %v, want 100", fc.Max)
	}

	// Disabled field: Enabled false, no type.
	fc = gpt.Capabilities.Fields["resolution"]
	if fc.Enabled {
		t.Error("resolution Enabled = true, want false")
	}

	// Constraint: shape round-trips.
	if got := len(gpt.Capabilities.Constraints); got != 1 {
		t.Fatalf("Constraints len = %d, want 1", got)
	}
	c := gpt.Capabilities.Constraints[0]
	if c.IfSet != "output_compression" {
		t.Errorf("Constraints[0].IfSet = %q, want output_compression", c.IfSet)
	}
	if c.Requires.Field != "output_format" {
		t.Errorf("Constraints[0].Requires.Field = %q, want output_format", c.Requires.Field)
	}
	if got, want := c.Requires.In, []string{"jpeg", "webp"}; !equalStrings(got, want) {
		t.Errorf("Constraints[0].Requires.In = %v, want %v", got, want)
	}

	// Model with no capabilities block: pointer is nil, not an
	// empty struct (the UI uses nil vs &{} to decide between
	// "use static defaults" and "explicitly empty").
	noCap := lists.Image[1]
	if noCap.Capabilities != nil {
		t.Errorf("no-cap-model Capabilities = %v, want nil", noCap.Capabilities)
	}
}

// TestApplyCapabilitiesConstraints_OpenAIImageCompression covers
// the constraint we ship by default for openai/gpt-image-2. The
// rule: output_compression > 0 requires output_format in
// {jpeg, webp}. We verify both the passing and failing cases.
func TestApplyCapabilitiesConstraints_OpenAIImageCompression(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "models.yaml")
	yaml := `
image:
  - id: "openai/gpt-image-2"
    name: "OpenAI GPT Image 2"
    capabilities:
      fields:
        output_format:
          enabled: true
          type: "enum"
          values: [png, jpeg, webp]
        output_compression:
          enabled: true
          type: "range"
          min: 0
          max: 100
      constraints:
        - if_set: output_compression
          requires:
            field: output_format
            in: [jpeg, webp]
          message: "this model only applies output_compression when output_format is jpeg or webp."

video: []
`
	if err := os.WriteFile(path, []byte(yaml), 0o644); err != nil {
		t.Fatal(err)
	}
	lists, err := parseModelsYAML(path)
	if err != nil {
		t.Fatal(err)
	}

	want := "this model only applies output_compression when output_format is jpeg or webp."
	cases := []struct {
		name   string
		params genParams
		want   string // "" means no violation
	}{
		{"no compression", genParams{OutputFormat: "png"}, ""},
		{"compression + jpeg", genParams{OutputFormat: "jpeg", OutputCompression: 80}, ""},
		{"compression + webp", genParams{OutputFormat: "webp", OutputCompression: 80}, ""},
		{"compression + png (violation)", genParams{OutputFormat: "png", OutputCompression: 80}, want},
		{"compression + no format (violation)", genParams{OutputCompression: 80}, want},
	}
	for _, c := range cases {
		got := applyCapabilitiesConstraints(lists, "openai/gpt-image-2", c.params)
		if got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

// TestApplyCapabilitiesConstraints_NoRuleFires covers the model
// without a capabilities block and the model with no constraints:
// both should return "" for any params.
func TestApplyCapabilitiesConstraints_NoRuleFires(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "models.yaml")
	yaml := `
image:
  - id: "no-cap"
    name: "No Cap"
video: []
`
	if err := os.WriteFile(path, []byte(yaml), 0o644); err != nil {
		t.Fatal(err)
	}
	lists, err := parseModelsYAML(path)
	if err != nil {
		t.Fatal(err)
	}
	// No cap block: no rules.
	if got := applyCapabilitiesConstraints(lists, "no-cap", genParams{OutputFormat: "png", OutputCompression: 80}); got != "" {
		t.Errorf("no-cap model: got %q, want \"\"", got)
	}
	// Unknown model: no rules (no panic).
	if got := applyCapabilitiesConstraints(lists, "unknown/model", genParams{OutputFormat: "png", OutputCompression: 80}); got != "" {
		t.Errorf("unknown model: got %q, want \"\"", got)
	}
}

// TestRefImagesMaxForModel verifies the per-model cap is read from
// the capabilities block, with a sensible fallback for models that
// don't report one.
func TestRefImagesMaxForModel(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "models.yaml")
	yaml := `
image:
  - id: "cap-3"
    name: "Cap 3"
    capabilities:
      fields:
        input_references:
          enabled: true
          type: "range"
          min: 0
          max: 3
  - id: "no-cap"
    name: "No Cap"
video: []
`
	if err := os.WriteFile(path, []byte(yaml), 0o644); err != nil {
		t.Fatal(err)
	}
	lists, err := parseModelsYAML(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := refImagesMaxForModel(lists, "cap-3"); got != 3 {
		t.Errorf("cap-3: got %d, want 3", got)
	}
	// No cap block: use the package default.
	if got := refImagesMaxForModel(lists, "no-cap"); got != maxReferenceImages {
		t.Errorf("no-cap: got %d, want %d", got, maxReferenceImages)
	}
	// Unknown model: package default.
	if got := refImagesMaxForModel(lists, "nope"); got != maxReferenceImages {
		t.Errorf("nope: got %d, want %d", got, maxReferenceImages)
	}
}

// TestCapabilitiesJSONShape pins down the wire JSON contract. The
// UI reads `cap.fields`, `cap.fields.<name>.enabled`, etc. —
// lowercase keys, omitempty for unset values. If the JSON tag
// here ever drifts from the UI's expectations, the form silently
// reverts to static defaults; this test catches that.
func TestCapabilitiesJSONShape(t *testing.T) {
	caps := &capabilities{
		Fields: map[string]fieldCap{
			"output_format": {Enabled: true, Type: "enum", Values: []string{"png", "jpeg"}},
			"resolution":    {Enabled: false},
		},
		Constraints: []constraint{{
			IfSet:    "output_compression",
			Requires: constraintNeed{Field: "output_format", In: []string{"jpeg", "webp"}},
			Message:  "x",
		}},
	}
	b, err := json.Marshal(caps)
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	// Top-level: lowercase keys.
	if !strings.Contains(s, `"fields":`) {
		t.Errorf("missing fields key: %s", s)
	}
	if !strings.Contains(s, `"constraints":`) {
		t.Errorf("missing constraints key: %s", s)
	}
	// Per-field: lowercase enabled/type/values; "type" omitted when
	// empty (we use omitempty so disabled fields with no type come
	// out as just {"enabled":false}).
	if !strings.Contains(s, `"enabled":true`) {
		t.Errorf("missing enabled:true: %s", s)
	}
	if !strings.Contains(s, `"type":"enum"`) {
		t.Errorf("missing type:enum: %s", s)
	}
	if !strings.Contains(s, `"values":["png","jpeg"]`) {
		t.Errorf("missing values: %s", s)
	}
	// Constraint: snake_case fields.
	if !strings.Contains(s, `"if_set":"output_compression"`) {
		t.Errorf("missing if_set: %s", s)
	}
	if !strings.Contains(s, `"requires":{"field":"output_format","in":["jpeg","webp"]}`) {
		t.Errorf("missing requires shape: %s", s)
	}
	// Disabled field: only `enabled` should be present (Type
	// omitted because it's the zero value + omitempty).
	if !strings.Contains(s, `"resolution":{"enabled":false}`) {
		t.Errorf("disabled field not minimal: %s", s)
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// TestGenErrorRawField pins the JSON envelope shape for genError:
// the `raw` field is a json.RawMessage that's emitted as-is when
// set, and omitted entirely when nil. The UI hides the disclosure
// when `raw` is absent; this test makes sure the omitempty
// behaviour doesn't regress.
func TestGenErrorRawField(t *testing.T) {
	// With Raw set: appears verbatim in the JSON.
	ge := genError{
		Message:   "x",
		Code:      "bad_request",
		Retryable: true,
		Raw:       json.RawMessage(`{"error":{"code":400,"message":"x"},"user_id":"u"}`),
	}
	b, err := json.Marshal(ge)
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	if !strings.Contains(s, `"raw":{"error":{"code":400,"message":"x"},"user_id":"u"}`) {
		t.Errorf("raw not forwarded as-is: %s", s)
	}
	// Without Raw: key absent from the JSON.
	ge2 := genError{Message: "x", Code: "bad_request"}
	b2, err := json.Marshal(ge2)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b2), `"raw"`) {
		t.Errorf("raw key should be omitted when nil: %s", b2)
	}
}

// TestRawFromAPIErrorBody ensures the helper accepts a JSON body
// and rejects anything that isn't JSON (so the UI never tries to
// pretty-print a fragment of HTML or an empty body).
func TestRawFromAPIErrorBody(t *testing.T) {
	if got := rawFromAPIErrorBody(`{"error":"x"}`); got == nil {
		t.Error("valid JSON returned nil")
	}
	if got := rawFromAPIErrorBody(""); got != nil {
		t.Errorf("empty body should return nil, got %s", got)
	}
	if got := rawFromAPIErrorBody("<html>nope</html>"); got != nil {
		t.Errorf("non-JSON should return nil, got %s", got)
	}
}
