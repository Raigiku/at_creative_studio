// modules/state.js
//
// Single source of truth for the entire form. Holds the state object
// and exposes:
//   - getState()          — read the state
//   - setState(patch)     — shallow-merge a patch and call render()
//   - subscribe(fn)       — listener called after every render
//   - render()            — apply state to the DOM (calls every
//                           module's apply* function in order)
//
// The render function is the *only* place that mutates the DOM
// outside of event handlers that just read the user's input (text
// fields, file picks, etc.). Every state change goes through
// setState() so render() is called exactly once per change.
//
// Why a separate file: this module is imported by every other module.
// Putting it first in the dep graph (it has no deps) avoids cycles.

// ---------------------------------------------------------------------------
// State shape. Initialized once; mutated via setState().
// ---------------------------------------------------------------------------
export const state = {
  // What the user picked
  kind: 'image',                        // form.type.value
  modelID: '',                          // form.model.value (set on bootstrap)
  models: { image: [], video: [] },     // from /api/models
  aspectActive: '1:1',                  // current active ratio

  // What the server told us about the current model
  capabilities: null,                   // { supported_params, param_details, quirks }

  // Per-model numeric overrides
  refMax: 16,                           // MAX_REFS by default; per-model when set
  sizeOverride: '',                     // the WxH string from size_vid

  // File inputs mirrored here so render() can rebuild previews
  // without reaching back into the <input>. (FileList objects are
  // mutable, so we keep our own reference and refresh it on change.)
  refFiles: emptyFileList(),
  frameFirstFile: null,
  frameLastFile: null,

  // Submit state
  isSubmitting: false,
  lastFailedBody: null,                 // FormData from the most recent failure
  lastFailedFields: null,               // unsupportedFields from the most recent failure
}

// Empty FileList shim. We use this on first render before the user
// has picked any files. (The real FileList is a hostile object —
// you can't construct one without an <input> — but for our purposes
// an object with .length 0 and a no-op iteration is enough.)
function emptyFileList() {
  return { length: 0, item: () => null, [Symbol.iterator]: function* () {} }
}

// ---------------------------------------------------------------------------
// Subscriber registry. Modules that own a part of the DOM (the
// reference previews, the aspect pills, etc.) register a render
// function here. setState() calls every subscriber in registration
// order. This is the inverse of the callback-fan-out problem: there
// is one notification path, and the order is fixed.
// ---------------------------------------------------------------------------
const _subscribers = []

export function subscribe(fn) {
  _subscribers.push(fn)
  return () => {
    const i = _subscribers.indexOf(fn)
    if (i >= 0) _subscribers.splice(i, 1)
  }
}

// render() runs every subscriber. We catch errors per-subscriber so
// one buggy module can't prevent the others from rendering. The
// first error is also reported via the global error reporter (set
// up in dom.js).
export function render() {
  for (const fn of _subscribers) {
    try {
      fn()
    } catch (err) {
      // Don't let one broken module prevent the rest from rendering.
      // Log + surface to the status bar via the on-page error
      // reporter that dom.js installed.
      console.error('render subscriber failed:', err)
      if (typeof window !== 'undefined' && window.__showScriptError) {
        window.__showScriptError('Render failed: ' + (err && err.message ? err.message : String(err)))
      }
    }
  }
}

// setState — shallow merge, then re-render. Use this for every state
// change so render() is called exactly once.
export function setState(patch) {
  for (const k of Object.keys(patch)) {
    state[k] = patch[k]
  }
  render()
}

// getState — read-only access. The state object is the canonical
// instance; do not mutate it directly. Always go through setState().
export function getState() {
  return state
}
