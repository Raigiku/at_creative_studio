package main

import (
	"net/http"
	"strings"
)

// handleModelCaps serves GET /api/models/{id} where {id} is the full
// OpenRouter model id (e.g. "x-ai/grok-imagine-image-quality"). The
// response is the model's capabilities block from the in-memory
// modelLists cache, looked up by id.
//
// Returns:
//
//   - 200 with the JSON-serialised capabilities object when the
//     model has one defined in models.yaml.
//   - 200 with literal `null` when the model is in models.yaml but
//     has no capabilities block. The UI treats null as "use static
//     defaults" (every field enabled, FIELD_FALLBACKS for enums).
//   - 404 when the model isn't in models.yaml at all. The UI uses
//     this to decide it doesn't know about the model.
func handleModelCaps(w http.ResponseWriter, r *http.Request, lists modelLists) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/models/"), "/")
	if id == "" {
		http.Error(w, "model id required (e.g. /api/models/x-ai/grok-imagine-image-quality)", http.StatusBadRequest)
		return
	}

	entry := findModelEntry(lists, id)
	if entry == nil {
		http.Error(w, "unknown model: "+id, http.StatusNotFound)
		return
	}

	// Returning *capabilities directly means a nil entry's block
	// serialises as JSON null (we want that), and a populated
	// block serialises as {"fields":...,"constraints":...}. The
	// UI reads `capabilities` and handles both shapes.
	writeJSON(w, entry.Capabilities)
}

// findModelEntry looks up a model by id in both the image and video
// lists. Returns nil if not found. The id is matched verbatim — we
// don't normalise case or trim slashes; what comes in is what was
// sent on the /api/models response and what the form has stored as
// state.modelID.
func findModelEntry(lists modelLists, id string) *modelEntry {
	for i := range lists.Image {
		if lists.Image[i].ID == id {
			return &lists.Image[i]
		}
	}
	for i := range lists.Video {
		if lists.Video[i].ID == id {
			return &lists.Video[i]
		}
	}
	return nil
}
