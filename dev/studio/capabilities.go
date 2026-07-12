package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	openrouter "github.com/OpenRouterTeam/go-sdk"
	"github.com/OpenRouterTeam/go-sdk/models/components"
)

// ----- per-model capabilities -----
//
// OpenRouter exposes per-model capability data on THREE endpoints:
//
//   1. GET /images/models/{author}/{slug}/endpoints  (the "definitive"
//      one for image models). Returns one entry per provider endpoint,
//      each with a `supported_parameters` map of name →
//      CapabilityDescriptor (enum / range / boolean). This is what
//      we want.
//
//   2. GET /videos/models  (video models — there is no per-model
//      endpoint, so we fetch the whole list once and cache it). Each
//      entry has flat fields like supported_aspect_ratios, supported_
//      resolutions, supported_durations, supported_sizes,
//      generate_audio, etc. The list is small enough to cache in
//      memory verbatim.
//
//   3. GET /models/{author}/{slug}  (the chat/text one). Returns the
//      top-level model record with `supported_parameters []string` —
//      JUST NAMES, no value allowlists. Useful for chat models but
//      useless for image-gen params like resolution / aspect_ratio.
//
// We try them in this order: image-endpoints → video-list lookup →
// chat-model fallback.
//
// The capabilities endpoint is cached in memory with a 1-hour TTL so
// switching models in the dropdown doesn't re-hit the network every
// time.

// paramDetail is the UI-facing representation of one supported
// parameter.
//
//   - "enum" params have Values: the list of allowed string values.
//   - "range" params have Min/Max: the inclusive bounds.
//   - "boolean" params: Values is empty, Min/Max are nil.
type paramDetail struct {
	Type   string   `json:"type"`             // "enum" | "range" | "boolean"
	Values []string `json:"values,omitempty"` // for "enum"
	Min    *float64 `json:"min,omitempty"`    // for "range"
	Max    *float64 `json:"max,omitempty"`    // for "range"
}

// capabilityResponse is what /api/models/{id} returns. The UI uses it
// to (a) replace dropdown options for enums, (b) clamp number inputs
// to ranges, (c) hide fields the model doesn't accept at all.
type capabilityResponse struct {
	ID                string                 `json:"id"`
	SupportedParams   []string               `json:"supported_params,omitempty"`
	ParamDetails      map[string]paramDetail `json:"param_details,omitempty"`
	InputModalities   []string               `json:"input_modalities,omitempty"`
	OutputModalities  []string               `json:"output_modalities,omitempty"`
	Providers         []string               `json:"providers,omitempty"`
	SupportsStreaming *bool                  `json:"supports_streaming,omitempty"`
	// Source describes where the data came from. Useful for debugging
	// ("why are my params empty?" → "source=models" means the
	// image-endpoints endpoint didn't return data and we fell back
	// to the chat-model endpoint, which only has param names).
	Source string `json:"source,omitempty"`
}

type capabilityCacheEntry struct {
	resp    capabilityResponse
	fetched time.Time
}

var (
	capabilityCacheMu sync.RWMutex
	capabilityCache   = map[string]capabilityCacheEntry{}
	capabilityTTL     = time.Hour

	// videoModelsCache caches the *whole* video models list. The
	// video endpoint doesn't have a per-model lookup, so we fetch
	// the full list once and look up the requested model id in
	// memory. The list is small (a few dozen models) so this is
	// trivial.
	videoListCacheMu sync.RWMutex
	videoListCache   []components.VideoModel
	videoListFetched time.Time
	videoListTTL     = time.Hour
)

// handleModelCapabilities serves GET /api/models/{id} where {id} is
// the full OpenRouter model id. Cache hits are served without a
// network round trip; cache misses call OpenRouter and populate the
// cache.
//
// Strategy:
//  1. Try the image endpoints endpoint first (has per-param enums).
//  2. If that fails, fall back to Models.Get (chat models — names
//     only, no value allowlists).
//  3. If both fail, return 502 — the UI will leave the form alone.
func handleModelCapabilities(w http.ResponseWriter, r *http.Request, client *openrouter.OpenRouter) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/models/"), "/")
	if id == "" {
		http.Error(w, "model id required (e.g. /api/models/x-ai/grok-imagine-image-quality)", http.StatusBadRequest)
		return
	}

	// Cache hit?
	capabilityCacheMu.RLock()
	if entry, ok := capabilityCache[id]; ok && time.Since(entry.fetched) < capabilityTTL {
		capabilityCacheMu.RUnlock()
		writeJSON(w, entry.resp)
		return
	}
	capabilityCacheMu.RUnlock()

	author, slug := splitAuthorSlug(id)
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	// Prefer the image endpoints endpoint — it has the real per-param
	// enums and ranges. A failure here is expected for non-image
	// models, so we just log and try the fallbacks.
	if resp, err := client.Images.ListModelEndpoints(ctx, author, slug); err == nil && resp != nil {
		out := convertImageEndpointsResponse(id, resp)
		capabilityCacheMu.Lock()
		capabilityCache[id] = capabilityCacheEntry{resp: out, fetched: time.Now()}
		capabilityCacheMu.Unlock()
		writeJSON(w, out)
		return
	} else if err != nil {
		fmt.Fprintf(os.Stderr, "note: Images.ListModelEndpoints(%s) failed: %v — trying video list\n", id, err)
	}

	// Try the video list. If the model is in there, we know it's a
	// video model and we can return real per-param data. The list
	// is cached in memory so we only hit the network once per hour.
	if vm, found, err := lookupVideoModel(ctx, client, id); err == nil && found {
		out := convertVideoModel(id, vm)
		capabilityCacheMu.Lock()
		capabilityCache[id] = capabilityCacheEntry{resp: out, fetched: time.Now()}
		capabilityCacheMu.Unlock()
		writeJSON(w, out)
		return
	} else if err != nil {
		fmt.Fprintf(os.Stderr, "note: video-list lookup for %s failed: %v — falling back to Models.Get\n", id, err)
	}

	// Fallback: chat/text model endpoint. Returns just param NAMES.
	if mResp, err := client.Models.Get(ctx, author, slug); err == nil && mResp != nil {
		out := convertModelResponse(id, mResp.Data)
		capabilityCacheMu.Lock()
		capabilityCache[id] = capabilityCacheEntry{resp: out, fetched: time.Now()}
		capabilityCacheMu.Unlock()
		writeJSON(w, out)
		return
	} else if err != nil {
		http.Error(w, "failed to fetch model capabilities: "+err.Error(), http.StatusBadGateway)
		return
	}

	http.Error(w, "empty response from model endpoints", http.StatusBadGateway)
}

// convertImageEndpointsResponse flattens the image-endpoints response
// (multiple provider endpoints per model) into a single UI response.
// When endpoints disagree on a param, the widest superset wins (union
// of enum values, broadest range bounds). The providers themselves
// are listed by slug for transparency.
func convertImageEndpointsResponse(id string, resp *components.ImageModelEndpointsResponse) capabilityResponse {
	out := capabilityResponse{
		ID:              id,
		Source:          "image-endpoints",
		SupportedParams: []string{},
		ParamDetails:    map[string]paramDetail{},
		Providers:       []string{},
	}
	if resp == nil {
		return out
	}
	seenProvider := map[string]bool{}
	anyStreaming := false
	streamingKnown := false
	paramUnion := map[string]paramDetail{}
	for _, ep := range resp.Endpoints {
		if !seenProvider[ep.ProviderSlug] {
			out.Providers = append(out.Providers, ep.ProviderSlug)
			seenProvider[ep.ProviderSlug] = true
		}
		anyStreaming = anyStreaming || ep.SupportsStreaming
		streamingKnown = true
		for name, d := range ep.SupportedParameters {
			paramUnion[name] = mergeParamDetail(paramUnion[name], d)
		}
	}
	if streamingKnown {
		s := anyStreaming
		out.SupportsStreaming = &s
	}
	for name := range paramUnion {
		out.SupportedParams = append(out.SupportedParams, name)
	}
	sortStrings(out.SupportedParams)
	for name, pd := range paramUnion {
		out.ParamDetails[name] = pd
	}
	return out
}

// lookupVideoModel searches the cached video list for a model with
// the given id (full OpenRouter id, e.g. "bytedance/seedance-2.0").
// If the cache is cold, fetches the full list and caches it. The
// list is small so caching it whole is trivial.
//
// Returns (model, true, nil) on hit, (zero, false, nil) on miss,
// and a non-nil error only when the network call itself failed.
func lookupVideoModel(ctx context.Context, client *openrouter.OpenRouter, id string) (components.VideoModel, bool, error) {
	// Cache hit? (Don't refetch just to check membership — if the
	// list is cached, look up in it.)
	videoListCacheMu.RLock()
	cached := videoListCache
	cachedAt := videoListFetched
	videoListCacheMu.RUnlock()
	if cached == nil || time.Since(cachedAt) >= videoListTTL {
		// Cold or stale: fetch.
		resp, err := client.VideoGeneration.ListVideosModels(ctx)
		if err != nil {
			return components.VideoModel{}, false, err
		}
		if resp == nil {
			return components.VideoModel{}, false, nil
		}
		videoListCacheMu.Lock()
		videoListCache = resp.Data
		videoListFetched = time.Now()
		videoListCacheMu.Unlock()
		cached = resp.Data
	}
	for _, m := range cached {
		if m.ID == id {
			return m, true, nil
		}
	}
	return components.VideoModel{}, false, nil
}

// convertVideoModel flattens a VideoModel into our param_details
// shape. The video response has flat typed fields (no generic
// `supported_parameters` map) so we map each one explicitly:
//
//   - supported_aspect_ratios → aspect_ratio (enum)
//   - supported_resolutions    → resolution (enum)
//   - supported_durations      → duration (range, min/max of the list)
//   - supported_sizes          → size (enum)
//   - supported_frame_images   → frame_first / frame_last (boolean)
//   - generate_audio           → generate_audio (boolean)
//   - seed (true/false)        → seed (boolean)
//
// Anything not present in the response is omitted from the UI
// response (the UI handles "missing field" by treating it as
// "use the static default").
func convertVideoModel(id string, m components.VideoModel) capabilityResponse {
	out := capabilityResponse{
		ID:              id,
		Source:          "videos",
		SupportedParams: []string{},
		ParamDetails:    map[string]paramDetail{},
	}
	if len(m.SupportedAspectRatios) > 0 {
		vals := make([]string, 0, len(m.SupportedAspectRatios))
		for _, v := range m.SupportedAspectRatios {
			if s := string(v); s != "" {
				vals = append(vals, s)
			}
		}
		sortStrings(vals)
		if len(vals) > 0 {
			out.ParamDetails["aspect_ratio"] = paramDetail{Type: "enum", Values: vals}
			out.SupportedParams = append(out.SupportedParams, "aspect_ratio")
		}
	}
	if len(m.SupportedResolutions) > 0 {
		vals := make([]string, 0, len(m.SupportedResolutions))
		for _, v := range m.SupportedResolutions {
			if s := string(v); s != "" {
				vals = append(vals, s)
			}
		}
		sortStrings(vals)
		if len(vals) > 0 {
			out.ParamDetails["resolution"] = paramDetail{Type: "enum", Values: vals}
			out.SupportedParams = append(out.SupportedParams, "resolution")
		}
	}
	if len(m.SupportedDurations) > 0 {
		// supported_durations is a list of integer seconds. We emit
		// it as an enum (not a range) so the UI can render a
		// <select> with the exact allowed values — even for
		// non-continuous lists like [5, 8, 10]. The server-side
		// applyVideoPolicy still enforces a hard cap of 10 seconds
		// regardless of what the model reports, so the UI's
		// dropdown is filtered implicitly: any value > 10 from a
		// model is just dropped by the server. (The UI can still
		// see the model's full list; the user just gets a 400 if
		// they somehow pick one above 10.)
		vals := make([]string, 0, len(m.SupportedDurations))
		for _, d := range m.SupportedDurations {
			vals = append(vals, strconv.FormatInt(d, 10))
		}
		sortStrings(vals)
		if len(vals) > 0 {
			out.ParamDetails["duration"] = paramDetail{Type: "enum", Values: vals}
			out.SupportedParams = append(out.SupportedParams, "duration")
		}
	}
	if len(m.SupportedSizes) > 0 {
		vals := make([]string, 0, len(m.SupportedSizes))
		for _, v := range m.SupportedSizes {
			if s := string(v); s != "" {
				vals = append(vals, s)
			}
		}
		sortStrings(vals)
		if len(vals) > 0 {
			out.ParamDetails["size"] = paramDetail{Type: "enum", Values: vals}
			out.SupportedParams = append(out.SupportedParams, "size")
		}
	}
	// Frame-image support. The form has two separate inputs
	// (frame_first, frame_last); we mark them as boolean-accepted
	// when the model advertises first_frame / last_frame.
	if len(m.SupportedFrameImages) > 0 {
		hasFirst, hasLast := false, false
		for _, f := range m.SupportedFrameImages {
			switch string(f) {
			case "first_frame":
				hasFirst = true
			case "last_frame":
				hasLast = true
			}
		}
		if hasFirst {
			out.ParamDetails["frame_first"] = paramDetail{Type: "boolean"}
			out.SupportedParams = append(out.SupportedParams, "frame_first")
		}
		if hasLast {
			out.ParamDetails["frame_last"] = paramDetail{Type: "boolean"}
			out.SupportedParams = append(out.SupportedParams, "frame_last")
		}
	}
	// Boolean features. Only emit the field if the model says
	// "supported" (true). If the value is nil, we leave it off
	// entirely so the UI doesn't auto-dim a field the model just
	// doesn't report on.
	if m.GenerateAudio != nil && *m.GenerateAudio {
		out.ParamDetails["generate_audio"] = paramDetail{Type: "boolean"}
		out.SupportedParams = append(out.SupportedParams, "generate_audio")
	}
	if m.Seed != nil && *m.Seed {
		out.ParamDetails["seed"] = paramDetail{Type: "boolean"}
		out.SupportedParams = append(out.SupportedParams, "seed")
	}
	// Output modality is always video for these models. Cheap to
	// include and helps the UI distinguish if we ever add a
	// "filter by modality" dropdown.
	out.OutputModalities = []string{"video"}
	return out
}

// mergeParamDetail unions an existing entry with a new one.
//
//   - Two enums → union of values, deduped, sorted.
//   - Two ranges → widened min/max.
//   - An enum + a range → the range wins (it permits any value in
//     [min,max], which is a superset of the enum's discrete values).
//   - A boolean + anything → just keep the name.
func mergeParamDetail(existing paramDetail, d components.CapabilityDescriptor) paramDetail {
	next := convertCapabilityDescriptor(d)
	if existing.Type == "" {
		return next
	}
	if existing.Type == "enum" && next.Type == "enum" {
		seen := map[string]bool{}
		merged := append([]string{}, existing.Values...)
		for _, v := range existing.Values {
			seen[v] = true
		}
		for _, v := range next.Values {
			if !seen[v] {
				seen[v] = true
				merged = append(merged, v)
			}
		}
		sortStrings(merged)
		return paramDetail{Type: "enum", Values: merged}
	}
	if existing.Type == "range" && next.Type == "range" {
		merged := paramDetail{Type: "range"}
		switch {
		case existing.Min == nil:
			merged.Min = next.Min
		case next.Min == nil:
			merged.Min = existing.Min
		case *existing.Min < *next.Min:
			merged.Min = existing.Min
		default:
			merged.Min = next.Min
		}
		switch {
		case existing.Max == nil:
			merged.Max = next.Max
		case next.Max == nil:
			merged.Max = existing.Max
		case *existing.Max > *next.Max:
			merged.Max = existing.Max
		default:
			merged.Max = next.Max
		}
		return merged
	}
	// Mismatched types — keep whichever is more general (range > enum > boolean).
	if existing.Type == "range" {
		return existing
	}
	if next.Type == "range" {
		return next
	}
	return paramDetail{Type: "boolean"}
}

// convertCapabilityDescriptor flattens the SDK's tagged-union
// CapabilityDescriptor into our paramDetail shape.
func convertCapabilityDescriptor(d components.CapabilityDescriptor) paramDetail {
	switch d.Type {
	case components.CapabilityDescriptorTypeEnum:
		if d.EnumCapability == nil {
			return paramDetail{Type: "enum"}
		}
		vals := append([]string{}, d.EnumCapability.Values...)
		sortStrings(vals)
		return paramDetail{Type: "enum", Values: vals}
	case components.CapabilityDescriptorTypeRange:
		if d.RangeCapability == nil {
			return paramDetail{Type: "range"}
		}
		min := d.RangeCapability.Min
		max := d.RangeCapability.Max
		return paramDetail{Type: "range", Min: &min, Max: &max}
	case components.CapabilityDescriptorTypeBoolean:
		return paramDetail{Type: "boolean"}
	default:
		return paramDetail{Type: string(d.Type)}
	}
}

// convertModelResponse flattens the chat-model response. Chat models
// don't have per-param enums, so ParamDetails is empty and the UI
// can only dim fields the model doesn't accept by name.
func convertModelResponse(id string, m components.Model) capabilityResponse {
	out := capabilityResponse{
		ID:           id,
		Source:       "models",
		ParamDetails: map[string]paramDetail{},
	}
	if len(m.SupportedParameters) > 0 {
		out.SupportedParams = make([]string, 0, len(m.SupportedParameters))
		for _, p := range m.SupportedParameters {
			if s := string(p); s != "" {
				out.SupportedParams = append(out.SupportedParams, s)
			}
		}
		sortStrings(out.SupportedParams)
	}
	if m.Architecture.InputModalities != nil {
		out.InputModalities = enumSliceToStrings(m.Architecture.InputModalities)
	}
	if m.Architecture.OutputModalities != nil {
		out.OutputModalities = enumSliceToStrings(m.Architecture.OutputModalities)
	}
	return out
}

// splitAuthorSlug splits "author/slug" into (author, slug). If there's
// no slash, author is empty and slug is the whole id.
func splitAuthorSlug(id string) (string, string) {
	i := strings.IndexByte(id, '/')
	if i < 0 {
		return "", id
	}
	return id[:i], id[i+1:]
}

// refImagesMaxForModel returns the per-model cap on reference images,
// derived from the cached capability response. If the model isn't in
// the cache, or doesn't expose `input_references` as a range, we fall
// back to `maxReferenceImages` (the package-level constant in
// config.go) so the server still has a safe upper bound.
//
// Note: this is read from the in-memory cache, not freshly fetched.
// A cold cache means "we don't know yet" → use the default. The
// UI layer is responsible for warming the cache by calling
// /api/models/{id} on model change; the server only validates on
// generate.
func refImagesMaxForModel(modelID string) int {
	capabilityCacheMu.RLock()
	entry, ok := capabilityCache[modelID]
	capabilityCacheMu.RUnlock()
	if !ok || time.Since(entry.fetched) >= capabilityTTL {
		return maxReferenceImages
	}
	ir, ok := entry.resp.ParamDetails["input_references"]
	if !ok || ir.Type != "range" || ir.Max == nil {
		return maxReferenceImages
	}
	// The model reported a cap. Floor it and clamp to the package
	// default so a misbehaving model can't claim an absurdly high
	// cap and bypass our upper bound.
	max := int(*ir.Max)
	if max < 0 {
		return maxReferenceImages
	}
	if max > maxReferenceImages {
		return maxReferenceImages
	}
	return max
}

// enumSliceToStrings converts a slice of any string-typed enum value
// to []string.
func enumSliceToStrings[T ~string](in []T) []string {
	if len(in) == 0 {
		return nil
	}
	out := make([]string, 0, len(in))
	for _, v := range in {
		if s := string(v); s != "" {
			out = append(out, s)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// sortStrings is an in-place insertion sort. These lists are tiny
// (dozens of items at most), so an O(n²) sort is fine and avoids
// importing "sort" just for one call site.
func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j-1] > s[j]; j-- {
			s[j-1], s[j] = s[j], s[j-1]
		}
	}
}
