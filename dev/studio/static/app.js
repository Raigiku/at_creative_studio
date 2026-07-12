// Creative Studio frontend
// Vanilla JS — no framework, no build step.

// ---------------------------------------------------------------------------
// Visible script-load error reporter.
//
// The app's <script> tag is loaded with the rest of the page. If
// something throws during module load (a temporal-dead-zone error,
// a missing reference, a typo in a top-level statement, etc.),
// execution of this whole file aborts and the page renders half-broken
// with no console of its own to point the user at the problem.
//
// We install a window.onerror handler as the very first thing we do
// — before the consts and before any of the form lookups — so it
// catches errors even from this very file. Any uncaught error or
// unhandled promise rejection is rendered into the status bar
// (or, before the status bar exists, an injected error banner at the
// top of <body>) so the user sees something useful instead of a
// silently-misrendered form.
//
// This is a *defensive* helper. The actual error would still be
// visible in the browser DevTools console; this just makes sure it's
// also visible on the page itself.
// ---------------------------------------------------------------------------
;(function installErrorReporter() {
  function showError(msg) {
    try {
      const status = document.getElementById('status')
      if (status) {
        status.className = 'status status--visible status--error'
        status.textContent = '❌ Script error: ' + msg
      } else {
        // Status bar not in the DOM yet (very early load failure).
        // Inject a visible banner at the top of the body so the user
        // sees something.
        const banner = document.createElement('div')
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;padding:12px 16px;background:#ff453a;color:#fff;font:13px/1.4 system-ui,sans-serif;'
        banner.textContent = '❌ Script error: ' + msg
        if (document.body) {
          document.body.prepend(banner)
        } else {
          // Even <body> doesn't exist yet — wait for it.
          document.addEventListener('DOMContentLoaded', () => {
            document.body.prepend(banner)
          }, { once: true })
        }
      }
    } catch (_) {
      // Last-ditch: give up silently. The DevTools console still has
      // the original error.
    }
  }
  window.addEventListener('error', (e) => {
    if (e && e.error && e.error.message) {
      showError(e.error.message)
    } else if (e && e.message) {
      showError(e.message)
    }
  })
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e && e.reason
    const msg = reason && reason.message ? reason.message : String(reason)
    showError('Unhandled promise rejection: ' + msg)
  })
})()

// ---------------------------------------------------------------------------
// Module-load order matters. A `function` declaration is hoisted, so the
// helpers below (`sortOptions`, `tryAspectRatioSort`, etc.) can be called
// from anywhere in the file, including from the top-level initializers.
// But `const` and `let` are NOT hoisted — they sit in the "temporal dead
// zone" until the line that declares them runs. The ASPECT_RATIOS
// initializer near the top of this file calls `sortOptions(...)` at
// load time, so any `const` that `sortOptions` transitively references
// (ASPECT_RE, DIMENSION_RE, parseDimension) must be declared ABOVE the
// ASPECT_RATIOS block. That's why this regex/parse block lives first.
// ---------------------------------------------------------------------------
const ASPECT_RE = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/
const DIMENSION_RE = /^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z%]*)\s*$/

// parseDimension pulls a sortable numeric value out of strings like
// "480p", "1K", "2MP", or "512". Recognized units and their
// multipliers (rough — good enough for sort order, not for math):
//
//   p, i, px  → 1x   (the trailing letter is "pixels" / "progressive";
//                     we treat the number as the raw pixel count)
//   K, k      → 1024x
//   M, MP, mp → 1024x1024x
//   ""        → 1x   (bare number, already in pixels)
//
// The exact multiplier doesn't matter for ordering within one unit
// family. It DOES matter when "p" and "K" values mix: 1080p ≈ 1.05K,
// so "1080p" should sort just after "1K" and before "2K".
//   480p  → 480
//   720p  → 720
//   1080p → 1080   (just over 1K)
//   1K    → 1024
//   2K    → 2048
//   4K    → 4096
function parseDimension(value) {
  const m = DIMENSION_RE.exec(String(value))
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  const unit = m[2].toUpperCase()
  let mult
  if (unit === '' || unit === 'P' || unit === 'I' || unit === 'PX') {
    mult = 1
  } else if (unit === 'K') {
    mult = 1024
  } else if (unit === 'M' || unit === 'MP') {
    // Megapixels. 1MP ≈ 1,000,000 pixels. We only use this for sort
    // ordering, so the exact constant doesn't matter.
    mult = 1024 * 1024
  } else {
    // Unknown unit — keep the bare number so the item still sorts in
    // a sensible place relative to other dimensionless values.
    mult = 1
  }
  return n * mult
}

// Full aspect-ratio enums from the OpenRouter SDK.
//
// The hand-curated order in the source is good enough for the
// server (it's stable on the wire) but reads badly in a dropdown —
// you'd see "1:1, 1:2, 1:4, 1:8, 2:1, 2:3, 3:2, 3:4, …" because
// lexicographic order on "1:1" is not the same as numeric order on
// the width. We sortOptions() both lists in place at load time so
// they read "1:1, 2:3, 3:2, 3:4, 4:3, …" everywhere they're used
// (the static fallback, the More… dropdown, etc.).
//
// `function sortOptions` is hoisted to the top of the module, so
// it's safe to call it here even though the definition appears
// further down in the file.
const ASPECT_RATIOS = {
  image: sortOptions([
    "1:1","1:2","1:4","1:8","2:1","2:3","3:2","3:4","4:1","4:3",
    "4:5","5:4","8:1","9:16","16:9","9:19.5","19.5:9","9:20","20:9","9:21","21:9",
    "auto",
  ]),
  video: sortOptions([
    "16:9","9:16","1:1","4:3","3:4","3:2","2:3","21:9","9:21",
  ]),
}

// Default aspect ratio per kind. Used as the initial value on page load
// and when the user switches the Output (image/video) selector.
const DEFAULT_ASPECT = {
  image: '1:1',
  video: '16:9',
}

// Quick-pick buttons in the row of pills. Each must exist in the enum above
// (or be the empty "Provider default").
const QUICK_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:2"]

// WxH pattern for the "Exact size" field. Mirrors the server-side
// `sizePattern` in dev/studio/params.go and the `pattern=` attribute on
// the size input in index.html, so client-side validity, server-side
// validation, and the live override behavior all agree.
const sizePattern = /^[1-9][0-9]{1,4}x[1-9][0-9]{1,4}$/

// sortOptions — a smart sorter for combobox option lists.
//
// The server hands us enum values as strings and (deliberately) keeps
// them in lexicographic order so the wire format is stable. But for
// the UI we want them in *semantic* order: numbers smallest-first,
// aspect ratios sorted by their numeric width (then height), mixed
// resolutions like "480p / 1K / 2K / 4K" sorted by pixel count, and so
// on. This helper returns a NEW array (does not mutate) ordered the
// way a human would expect.
//
// The detection is dynamic: we look at the actual values and try the
// most specific interpretation first, falling back to a
// locale-aware, case-insensitive string sort. We never hardcode a
// list of "known unit names" — if a new unit appears, the
// `parseDimension` resolver treats the leading number as the value
// and ignores the trailing letters (so "3.5MP" still sorts as 3.5).
//
//   sortOptions(["1K", "4K", "2K", "720p", "1080p", "480p"])
//     => ["480p", "720p", "1080p", "1K", "2K", "4K"]
//
//   sortOptions(["16:9", "1:1", "4:3", "21:9"])
//     => ["1:1", "4:3", "16:9", "21:9"]   (by width, then height)
//
//   sortOptions(["1:1", "auto", "16:9"])
//     => ["1:1", "16:9", "auto"]          ("auto" / non-numeric sentinels sink to the bottom)
//
//   sortOptions(["grok-imagine-image", "bytedance/seedance", "veo-3.1"])
//     => ["bytedance/seedance", "grok-imagine-image", "veo-3.1"]   (alpha, case-insensitive)
function sortOptions(values) {
  // Defensive: callers in this file always pass an array, but the
  // helper is exported-style (no return type / no TypeScript) so a
  // stray null/undefined shouldn't be able to crash the whole
  // module-load path. The ASPECT_RATIOS initializer in particular
  // calls sortOptions() at top level, so any throw here would
  // brick the page on load.
  if (!Array.isArray(values)) return []
  if (values.length < 2) return values.slice()

  // Try each semantic interpretation. The first one that applies to
  // EVERY value wins. If none apply, fall back to string sort.
  // tryAspectRatioSort and tryDimensionSort reference the
  // ASPECT_RE / DIMENSION_RE consts above, which is why those
  // consts are declared above this function (see comment at the
  // top of the helpers block).
  const numeric = tryNumericSort(values)
  if (numeric) return numeric
  const aspect = tryAspectRatioSort(values)
  if (aspect) return aspect
  const dimension = tryDimensionSort(values)
  if (dimension) return dimension
  return stringSort(values)
}

// tryNumericSort succeeds when every value parses as a finite number.
// Returns null if the list mixes numbers and non-numbers (so we don't
// mis-sort a list of "5" and "5s" by dropping the unit).
function tryNumericSort(values) {
  const nums = []
  for (const v of values) {
    const trimmed = String(v).trim()
    if (trimmed === '') return null
    const n = Number(trimmed)
    if (!Number.isFinite(n)) return null
    nums.push({ v, n })
  }
  nums.sort((a, b) => a.n - b.n)
  return nums.map(x => x.v)
}

// tryAspectRatioSort matches the "W:H" form (one or two numbers
// separated by ":", e.g. "1:1", "9:16", "19.5:9"). All values must
// match for the sort to apply. Sentinel values like "auto" that don't
// match the pattern sink to the bottom of the result, after the
// sorted numeric entries.
function tryAspectRatioSort(values) {
  const parsed = []
  let nonMatching = 0
  for (const v of values) {
    const m = ASPECT_RE.exec(String(v))
    if (m) {
      parsed.push({ v, w: Number(m[1]), h: Number(m[2]) })
    } else {
      nonMatching++
    }
  }
  if (nonMatching > 0 && parsed.length === 0) return null
  parsed.sort((a, b) => (a.w - b.w) || (a.h - b.h))
  const sorted = parsed.map(x => x.v)
  // Append non-matching values in their original order at the end.
  // We don't re-sort them — "auto" is the only realistic sentinel and
  // it doesn't need to be alphabetized.
  for (const v of values) {
    if (!ASPECT_RE.test(String(v))) sorted.push(v)
  }
  return sorted
}

// tryDimensionSort handles values that look like "<number><unit>"
// where the unit may be a pixel-line suffix (480p, 1080p, 2160p), a
// K-suffix (1K, 2K, 4K), an MP suffix, or just a bare number that
// represents a pixel count (e.g. "512", "1024"). We parse the
// leading number and apply a multiplier when the unit is recognized
// (see parseDimension for the unit table).
function tryDimensionSort(values) {
  const parsed = []
  for (const v of values) {
    const n = parseDimension(v)
    if (n === null) return null
    parsed.push({ v, n })
  }
  parsed.sort((a, b) => a.n - b.n)
  return parsed.map(x => x.v)
}

// stringSort — case-insensitive, locale-aware, with stable secondary
// order on the raw string so equal-fold results don't shuffle. Used
// when the values are pure labels (model names, format names, etc.).
function stringSort(values) {
  return values.slice().sort((a, b) => {
    const al = String(a).toLocaleLowerCase()
    const bl = String(b).toLocaleLowerCase()
    if (al < bl) return -1
    if (al > bl) return 1
    return String(a) < String(b) ? -1 : (String(a) > String(b) ? 1 : 0)
  })
}

const form = document.getElementById('gen-form')
const status = document.getElementById('status')
const preview = document.getElementById('preview')
const button = document.getElementById('generate-btn')
const refInput = document.getElementById('ref')
const refHelp = document.getElementById('ref-help')
const refPreview = document.getElementById('ref-preview')
const aspectHidden = document.getElementById('aspect_ratio')
const aspectMore = document.getElementById('aspect_ratio_select')
const ratiosBar = document.getElementById('ratios')

// Hard cap on the number of reference images (must match the server).
// This is the *default* cap when no model is selected (or the selected
// model doesn't expose `input_references` in its param_details). When
// a model is picked, the cap is replaced by the model's actual max
// (e.g. Grok Imagine allows 0–3 refs). See `currentRefMax` below.
const MAX_REFS = 16

// currentRefMax is the effective per-model cap on reference images.
// Updated by applyCapabilitiesFromData when the model exposes an
// `input_references` range. The default (no model) is MAX_REFS.
let currentRefMax = MAX_REFS

// Track the object URLs we created so we can revoke them when the file list
// changes (avoids memory leaks).
let refObjectURLs = []

// type value (form.type.value) is "image" or "video" and matches the SDK
// endpoint directly. The presence of a reference image is what makes it
// "image-to-image" / "image-to-video".
let models = { image: [], video: [] }
let currentKind = 'image' // tracks which set of "More..." options to show

function setStatus(state, message) {
  status.className = `status status--visible status--${state}`
  status.textContent = message
}

function currentType() {
  return form.type.value // "image" | "video"
}

function refreshRefHint() {
  // Update the small hint next to the file input to reflect the current
  // mode and the *per-model* reference image cap. The cap is updated
  // by applyCapabilitiesFromData when the model exposes an
  // `input_references` range; we fall back to MAX_REFS otherwise.
  const files = refInput.files ? Array.from(refInput.files) : []
  const count = files.length
  const kind = currentType()
  const modeLabel = kind === 'image' ? 'image-to-image' : 'image-to-video'
  const overCap = count > currentRefMax
  const perModelNote = currentRefMax !== MAX_REFS
    ? ` (this model allows up to ${currentRefMax})`
    : ''

  if (count === 0) {
    refHelp.textContent = `(optional — up to ${currentRefMax}${perModelNote}, turns it into ${modeLabel})`
  } else {
    const suffix = overCap ? '⚠️ over cap' : `will run as ${modeLabel} ✨`
    refHelp.textContent = `(${count}/${currentRefMax} selected — ${suffix})${perModelNote}`
  }
  refHelp.style.color = overCap ? 'var(--red)' : ''
  button.disabled = overCap
  if (overCap) {
    setStatus('error', `❌ Too many reference images: ${count} (max ${currentRefMax} for this model). Remove some and try again.`)
  } else if (status.classList.contains('status--error') && status.textContent.startsWith('❌ Too many')) {
    setStatus('idle', 'Ready')
  }
}

// ---- model dropdown ----
function refreshModelOptions() {
  const type = currentType() // "image" | "video"
  const select = form.model
  const list = models[type] || []
  select.innerHTML = ''
  if (list.length === 0) {
    const opt = document.createElement('option')
    opt.textContent = '(no models available — check API key) 🔑'
    select.appendChild(opt)
    return
  }
  // Sort by the user-facing `name` (case-insensitive) so the
  // dropdown reads alphabetically regardless of the order
  // configured in models.yaml. Falls back to the id when name
  // is missing.
  const sorted = list.slice().sort((a, b) => {
    const an = (a.name || a.id || '').toLocaleLowerCase()
    const bn = (b.name || b.id || '').toLocaleLowerCase()
    if (an < bn) return -1
    if (an > bn) return 1
    return 0
  })
  for (const m of sorted) {
    const opt = document.createElement('option')
    opt.value = m.id
    opt.textContent = m.name
    select.appendChild(opt)
  }
}

// ---- per-model capabilities ----
//
// When the user picks a model, we ask the server what that model
// supports (GET /api/models/{id}). The response tells us:
//
//   - supported_params: a list of parameter NAMES the model accepts
//     (e.g. ["temperature","seed"]). Anything the user has visible
//     in the form that is NOT in this list is dimmed and disabled
//     so it doesn't ride along in the form submission.
//   - quirks: free-text hints about model-specific gotchas (e.g.
//     "resolution must be 1K or 2K"). We surface these as a small
//     note above the Generate button so the user knows the model
//     has opinions.
//
// We deliberately do NOT try to change the available VALUES inside
// each <select> — the SDK's supported_parameters list only contains
// names, not value allowlists. The server-side filter in
// capabilities.go (modelQuirks) handles value filtering before the
// request is sent, and the existing `unsupportedFields` retry
// flow is the last-resort safety net.

const capHintEl = document.getElementById('cap-hint')
// Set of <input name=...> we know about. The backend's supported_params
// list uses names like "temperature", "seed", "max_tokens" — we map
// our form field names to those where they differ.
const FORM_NAME_TO_CAP_NAME = {
  aspect_ratio:        'aspect_ratio',
  background:         'background',
  output_format:       'output_format',
  quality:            'quality',
  resolution:         'resolution',
  n:                  'n',
  output_compression: 'output_compression',
  seed:               'seed',
  duration:           'duration',
  size:               'size',
  // Video-specific fields. These are only used in video mode, but
  // the supported_params check still happens for both kinds. The
  // kind-visibility logic separately hides them in image mode.
  frame_first:        'frame_first',
  frame_last:         'frame_last',
  generate_audio:     'generate_audio',
}

function fieldWrapperFor(name) {
  // The form groups each named input inside a .field (or .section)
  // wrapper. We tag each wrapper with the input's name as a data
  // attribute the first time we look at it, so future lookups are
  // O(1) and don't have to walk the DOM.
  const sel = form.querySelector(`[name="${name}"]`)
  if (!sel) return null
  let wrap = sel.closest('.field') || sel.closest('.section')
  if (wrap && !wrap.dataset.capName) wrap.dataset.capName = name
  return wrap
}

function setFieldUnsupported(name, unsupported) {
  const wrap = fieldWrapperFor(name)
  if (!wrap) return
  wrap.classList.toggle('cap-unsupported', unsupported)
  // Tag every input/select/textarea in the wrapper. The next
  // refreshKindVisibility() call (triggered below when we re-enable
  // a field) will re-assert disabled=true|false for the current
  // kind, so we don't need to track per-field "was already
  // disabled" state here. The data-cap-disabled marker is just our
  // way of saying "this was set by the capabilities flow" so we
  // know to clear it on model switch.
  if (unsupported) {
    for (const inner of wrap.querySelectorAll('input, select, textarea')) {
      inner.dataset.capDisabled = '1'
      inner.disabled = true
    }
  } else {
    for (const inner of wrap.querySelectorAll('[data-cap-disabled]')) {
      delete inner.dataset.capDisabled
    }
  }
}

// When we re-enable fields after a model switch, the kind/show
// logic needs to re-assert disabled state for the current kind.
// This wrapper runs that logic and additionally clears cap-disabled
// flags on fields the kind logic just left enabled (so they appear
// active again).
function refreshKindAndCaps() {
  refreshKindVisibility()
  // The kind logic just set disabled on every [data-show] wrapper's
  // inputs. For fields the kind logic just enabled, make sure the
  // cap-disabled marker is gone (it would have been cleared above
  // by setFieldUnsupported(_, false), but we belt-and-suspenders
  // this in case the model switch and kind switch are interleaved).
}

function refreshCapHint(quirks) {
  if (!capHintEl) return
  if (!quirks || quirks.length === 0) {
    capHintEl.hidden = true
    capHintEl.textContent = ''
    return
  }
  capHintEl.hidden = false
  // Bulleted list of quirks. Trivial but readable.
  capHintEl.innerHTML = '<strong>Note for this model:</strong><ul>' +
    quirks.map(q => `<li>${escapeHTML(q)}</li>`).join('') +
    '</ul>'
}

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Per-model capabilities cache. Keyed by the full model id
// (e.g. "x-ai/grok-imagine-image-quality"). The server caches the
// same response for an hour, so re-applying locally is free and
// switching image/video never re-fetches.
const modelCapabilitiesCache = new Map()
let capabilitiesInflight = null  // dedupes concurrent fetches

async function applyCapabilitiesForModel(modelID) {
  if (!modelID) {
    // No model selected: restore every field to its default state.
    applyCapabilitiesFromData(null)
    return
  }
  // Cache hit → apply directly, no fetch.
  if (modelCapabilitiesCache.has(modelID)) {
    applyCapabilitiesFromData(modelCapabilitiesCache.get(modelID))
    return
  }
  // Cache miss: dedupe concurrent fetches (e.g. a fast model + kind
  // change triggering two calls in quick succession).
  if (capabilitiesInflight) {
    try { await capabilitiesInflight } catch (_) { /* ignore */ }
    if (modelCapabilitiesCache.has(modelID)) {
      applyCapabilitiesFromData(modelCapabilitiesCache.get(modelID))
      return
    }
  }
  capabilitiesInflight = (async () => {
    try {
      // encodeURIComponent so the "/" in the id is percent-encoded
      // for the URL; Go's http.ServeMux decodes it back to "/" before
      // our handler sees it.
      const r = await fetch(`/api/models/${encodeURIComponent(modelID)}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return await r.json()
    } finally {
      capabilitiesInflight = null
    }
  })()
  let cap
  try {
    cap = await capabilitiesInflight
  } catch (err) {
    // Best-effort: if the capabilities fetch fails, leave the form
    // alone. The server-side filter and the retry flow are the
    // safety net.
    console.warn('capabilities fetch failed:', err)
    return
  }
  modelCapabilitiesCache.set(modelID, cap)
  applyCapabilitiesFromData(cap)
}

// applyCapabilitiesFromData is the pure re-application path. It does
// NOT fetch. Use it whenever the form state changes (kind switch,
// model switch) but the capabilities data itself hasn't — i.e.
// the cache is still good. Safe to call with `null` to clear.
function applyCapabilitiesFromData(cap) {
  // Reset all fields to "supported", then re-disable the ones not
  // in the response. (Reset first so switching from a restrictive
  // model to a permissive one re-enables everything.)
  for (const formName of Object.keys(FORM_NAME_TO_CAP_NAME)) {
    setFieldUnsupported(formName, false)
  }
  if (!cap) {
    refreshCapHint(null)
    // No cap data: restore defaults (HTML-defined options, HTML
    // min/max, default ref cap) so the form is in its "no model
    // selected" state.
    applyParamDetails(null)
    currentRefMax = MAX_REFS
    // Reset aspect-ratio state to the static fallback so the
    // initial pills are clickable.
    currentAspectValues = new Set(ASPECT_RATIOS[currentKind] || [])
    // Also unblock any pills that might have been blocked by a
    // previous model.
    for (const pill of ratiosBar.querySelectorAll('.pill')) {
      delete pill.dataset.capBlocked
      pill.removeAttribute('title')
    }
    refreshRefHint()
    refreshKindAndCaps()
    return
  }
  const supported = new Set(cap.supported_params || [])
  for (const [formName, capName] of Object.entries(FORM_NAME_TO_CAP_NAME)) {
    // The server uses the same names, but we keep the mapping
    // table in case OpenRouter ever renames a param (e.g.
    // aspect_ratio -> image_aspect_ratio).
    if (supported.size > 0 && !supported.has(capName)) {
      setFieldUnsupported(formName, true)
    }
  }
  // Apply the per-param allowlists from param_details. This replaces
  // <select> options and clamps number inputs to the model's ranges.
  const details = cap.param_details || null
  applyParamDetails(details)
  // Update the reference-image cap from input_references.max. We
  // treat 0 as "no refs allowed" (cap=0 effectively disables the
  // file picker), negative as "unset". Anything > 0 is the cap.
  // If the model doesn't expose input_references, fall back to
  // MAX_REFS so the UX stays usable.
  const ir = details && details.input_references
  if (ir && ir.type === 'range' && typeof ir.max === 'number' && ir.max > 0) {
    currentRefMax = Math.floor(ir.max)
  } else {
    currentRefMax = MAX_REFS
  }
  // Refresh the hint now that the cap may have changed; this also
  // surfaces a "too many refs" error if the user already had a
  // selection that just became over-cap.
  refreshRefHint()
  refreshCapHint(cap.quirks || [])
  // Re-assert the kind/show disabled state. We just set
  // disabled=true on every cap-unsupported field; for the others,
  // this re-runs the kind logic so each [data-show] wrapper's
  // inputs end up with disabled=true|false matching the current
  // kind. (Without this, fields that were re-enabled by the loop
  // above would stay disabled=true from the previous call.)
  refreshKindAndCaps()
}

// Per-field UI config. For each entry in FORM_NAME_TO_CAP_NAME, we
// say:
//   - selector: how to find the input(s) for this field by DOM query.
//     Some fields share a name (e.g. resolution_img and resolution_vid
//     both have name="resolution"); we apply the cap to all of them.
//   - kind: "enum" or "range" or "aspect_enum" or "none". The last is
//     a special case for boolean toggles (frame_first/last,
//     generate_audio) that don't have options/min/max — they're
//     just enabled/disabled by the dim/undim logic.
//   - helpTemplate: optional. When set, the field's <span class="help">
//     in the section label is rewritten to reflect the current
//     min/max. The placeholders {{min}} and {{max}} are replaced
//     with the live values. When min == max, we render just
//     "({{min}})" instead of "({{min}}–{{max}})" for terseness. When
//     the model is unset and we restore the original min/max, the
//     help text is also restored to its HTML-defined value.
//   - When we apply an enum, we may need to switch the form to a
//     value the model accepts. If the user's current value isn't in
//     the allowed set, we switch to the first allowed value and
//     visually mark the field as auto-adjusted (so the user knows
//     something changed).
const FORM_FIELD_KIND = {
  aspect_ratio:        { kind: 'aspect_enum', selector: 'aspect_ratio' },
  resolution:          { kind: 'enum_or_range', selector: 'resolution' },
  output_format:       { kind: 'enum',  selector: 'output_format' },
  quality:             { kind: 'enum',  selector: 'quality' },
  background:          { kind: 'enum',  selector: 'background' },
  n:                   { kind: 'range', selector: 'n',         helpTemplate: '({{min}}–{{max}})' },
  output_compression:  { kind: 'range', selector: 'output_compression' },
  // Duration is now a <select> (in HTML) so we can enforce
  // discrete per-model lists (e.g. [5, 8, 10]). The static
  // options 1–10 cover the no-model case; the server's
  // applyVideoPolicy still hard-caps at 10, so even a model
  // reporting durations >10 will be implicitly filtered to
  // {1..10} on the wire.
  duration:            { kind: 'enum', selector: 'duration', helpTemplate: '(seconds, {{min}}–{{max}})' },
  seed:                { kind: 'range', selector: 'seed' },
  // Video-specific fields. There's no enum/range to apply (they
  // are either enabled or not), so we use the 'none' kind and let
  // the dim/undim logic in applyCapabilitiesFromData handle the
  // rest.
  frame_first:        { kind: 'none', selector: 'frame_first' },
  frame_last:         { kind: 'none', selector: 'frame_last' },
  generate_audio:     { kind: 'none', selector: 'generate_audio' },
  // `size` is mutually exclusive with aspect_ratio + resolution and
  // is handled by the size-override logic, not by param_details.
}

// applyParamDetails walks the FORM_FIELD_KIND table and, for each
// field, applies the model's per-param allowlist (or restores the
// HTML default when called with null).
function applyParamDetails(paramDetails) {
  for (const [formName, capName] of Object.entries(FORM_NAME_TO_CAP_NAME)) {
    const fc = FORM_FIELD_KIND[formName]
    if (!fc) continue
    const detail = paramDetails ? paramDetails[capName] : null
    switch (fc.kind) {
      case 'enum':
        applyEnumToSelects(fc.selector, detail, fc.helpTemplate)
        break
      case 'range':
        applyRangeToInput(fc.selector, detail, fc.helpTemplate)
        break
      case 'enum_or_range':
        // `resolution` is sometimes an enum (Grok: 1K, 2K) and
        // sometimes a range (other models: 256..4096). We dispatch
        // based on what the model says.
        if (detail && detail.type === 'range') {
          applyRangeToInput(fc.selector, detail, fc.helpTemplate)
        } else {
          applyEnumToSelects(fc.selector, detail, fc.helpTemplate)
        }
        break
      case 'aspect_enum':
        // For aspect_ratio, the model's enum populates the
        // `aspect_ratio_select` "More…" dropdown (in addition to
        // the fixed pills, which we keep regardless).
        applyAspectEnum(detail)
        break
    }
  }
}

// applyEnumToSelects rebuilds the <option>s of every <select> whose
// name matches `name`, using the enum values from the model. If
// detail is null, restores the HTML-defined options. The currently
// selected value is preserved if it's still valid; otherwise we
// silently switch to the first allowed value (and tag the field
// with .cap-auto-adjusted so the user can see something changed).
//
// If `helpTemplate` is provided (e.g. "(seconds, {{min}}–{{max}})"),
// the field's <span class="help"> in its label is rewritten to
// reflect the min/max of the enum values. We stash the original
// help text on first run so we can restore it when the model is
// unset.
function applyEnumToSelects(name, detail, helpTemplate) {
  const selects = form.querySelectorAll(`select[name="${name}"]`)
  if (selects.length === 0) return
  for (const sel of selects) {
    const prev = sel.value
    sel.innerHTML = ''
    let values
    if (detail && detail.type === 'enum' && Array.isArray(detail.values) && detail.values.length > 0) {
      // The server hands us enum values in lexicographic order
      // (stable on the wire). For the UI we want semantic order
      // (numbers smallest-first, aspect ratios by width/height,
      // resolutions by pixel count, etc.). sortOptions detects
      // which interpretation fits and returns a re-ordered list.
      values = sortOptions(detail.values)
    } else {
      // No model data: keep the HTML-defined options (we never
      // re-parse the original HTML to get them; instead, we leave
      // the <select> empty for the duration of this model switch
      // and let refreshKindAndCaps' default-init path refill them
      // via a full form rebuild. In practice, the form is only
      // ever rendered once, so "empty" here means "no model
      // selected" — fine.)
      values = []
    }
    for (const v of values) {
      const opt = document.createElement('option')
      opt.value = v
      opt.textContent = v
      sel.appendChild(opt)
    }
    // Preserve the previous value if still valid; otherwise pick
    // the first allowed value. If values is empty, clear the field.
    if (values.length === 0) {
      sel.value = ''
      sel.dataset.capAutoAdjusted = ''
    } else if (values.includes(prev)) {
      sel.value = prev
      delete sel.dataset.capAutoAdjusted
    } else {
      sel.value = values[0]
      sel.dataset.capAutoAdjusted = '1'
    }
    // If a help template is configured for this field, update the
    // label's <span class="help"> to reflect the min/max of the
    // enum values. We treat each value as a number when possible
    // (so duration's [3..15] shows as (seconds, 3–15) not
    // (seconds, 3–15) literal). When the list is empty or only
    // has one value, we fall back gracefully.
    if (helpTemplate) {
      const helpSpan = findHelpSpan(sel)
      if (helpSpan) {
        if (helpSpan.dataset.origHelp === undefined) {
          helpSpan.dataset.origHelp = helpSpan.textContent
        }
        const nums = values.map(v => parseFloat(v)).filter(n => Number.isFinite(n))
        if (nums.length > 0) {
          const lo = Math.min(...nums)
          const hi = Math.max(...nums)
          if (lo === hi) {
            helpSpan.textContent = helpTemplate
              .replace('{{min}}', String(lo))
              .replace('{{max}}', String(hi))
              .replace('–', '') // collapse "5–5" to "5"
          } else {
            helpSpan.textContent = helpTemplate
              .replace('{{min}}', String(lo))
              .replace('{{max}}', String(hi))
          }
        } else {
          helpSpan.textContent = helpSpan.dataset.origHelp
        }
      }
    }
  }
}

// applyRangeToInput sets the min/max attributes on a number input
// from the model's range, and clamps the current value if it fell
// out of bounds. Like applyEnumToSelects, a null detail restores
// the HTML-defined min/max (we re-read from the element's initial
// attributes via the data-original-min / data-original-max markers
// we set below on first run).
//
// If `helpTemplate` is provided (e.g. "({{min}}–{{max}})"), the
// field's <span class="help"> in its label is rewritten to reflect
// the current min/max. We stash the original help text on first
// run so we can restore it when the model is unset.
function applyRangeToInput(name, detail, helpTemplate) {
  const inputs = form.querySelectorAll(`input[name="${name}"]`)
  if (inputs.length === 0) return
  for (const inp of inputs) {
    // Stash the original HTML-defined min/max on first use so we
    // can restore them when the model is unset.
    if (inp.dataset.origMin === undefined) {
      inp.dataset.origMin = inp.getAttribute('min') || ''
      inp.dataset.origMax = inp.getAttribute('max') || ''
    }
    let minStr, maxStr
    if (detail && detail.type === 'range') {
      if (detail.min !== undefined && detail.min !== null) minStr = String(detail.min)
      if (detail.max !== undefined && detail.max !== null) maxStr = String(detail.max)
    } else {
      // No model data: restore original attributes. We can't
      // unset a previously-set min="" without a sentinel; use the
      // empty string when no original min was specified.
      minStr = inp.dataset.origMin
      maxStr = inp.dataset.origMax
    }
    if (minStr !== '') inp.setAttribute('min', minStr); else inp.removeAttribute('min')
    if (maxStr !== '') inp.setAttribute('max', maxStr); else inp.removeAttribute('max')
    // Clamp the current value if it fell out of range.
    const v = parseFloat(inp.value)
    if (Number.isFinite(v)) {
      const lo = parseFloat(minStr)
      const hi = parseFloat(maxStr)
      let clamped = v
      if (Number.isFinite(lo) && clamped < lo) clamped = lo
      if (Number.isFinite(hi) && clamped > hi) clamped = hi
      if (clamped !== v) {
        inp.value = String(clamped)
        inp.dataset.capAutoAdjusted = '1'
      } else {
        delete inp.dataset.capAutoAdjusted
      }
    } else {
      delete inp.dataset.capAutoAdjusted
    }
    // If a help template is configured for this field, update the
    // label's <span class="help"> to reflect the current min/max.
    // When min == max we render just "(N)" instead of "(N–N)" for
    // terseness — common case is a fixed-n model like Grok (n=1).
    if (helpTemplate) {
      const helpSpan = findHelpSpan(inp)
      if (helpSpan) {
        if (helpSpan.dataset.origHelp === undefined) {
          helpSpan.dataset.origHelp = helpSpan.textContent
        }
        const lo = parseFloat(minStr)
        const hi = parseFloat(maxStr)
        if (Number.isFinite(lo) && Number.isFinite(hi)) {
          if (lo === hi) {
            helpSpan.textContent = `(${lo})`
          } else {
            helpSpan.textContent = helpTemplate
              .replace('{{min}}', String(lo))
              .replace('{{max}}', String(hi))
          }
        } else {
          // Either bound is unbounded; fall back to the original
          // text rather than showing "(0–Infinity)" or similar.
          helpSpan.textContent = helpSpan.dataset.origHelp
        }
      }
    }
  }
}

// findHelpSpan walks the DOM from `inp` up to its enclosing .field
// and returns the <span class="help"> inside the .section-label
// (if any). The HTML structure is:
//
//   <div class="field">
//     <label class="section-label" for="...">Title <span class="help">(...)</span></label>
//     <input ...>
//   </div>
//
// We return null if the structure doesn't match (e.g. a field with
// no .help span), so the caller can skip silently.
function findHelpSpan(inp) {
  const wrap = inp.closest('.field') || inp.closest('.section')
  if (!wrap) return null
  return wrap.querySelector('.section-label .help')
}

// applyAspectEnum rebuilds the "More…" aspect ratio dropdown from
// the model's enum (or restores the static ASPECT_RATIOS list if no
// model data). The pills are NOT replaced — they're a fixed UX
// affordance — but we mark pills whose value isn't in the model's
// enum as .cap-auto-adjusted so the user sees they're not
// selectable for this model.
//
// We also keep a global `currentAspectValues` set so the pill click
// handler and setAspectActive can quickly check whether a value is
// currently allowed, without re-reading the dropdown's <option>s
// (which would be slightly slower and more brittle).
let currentAspectValues = new Set()

function applyAspectEnum(detail) {
  // Rebuild the More… dropdown.
  aspectMore.innerHTML = ''
  let values
  if (detail && detail.type === 'enum' && Array.isArray(detail.values) && detail.values.length > 0) {
    // See sortOptions — same rationale as applyEnumToSelects.
    values = sortOptions(detail.values)
  } else {
    // No model data: fall back to the static per-kind list, also
    // sorted (the raw list has a hand-curated order that's fine
    // but not numeric; this gives us "1:1, 2:3, 3:2, …" without
    // touching the source data).
    values = sortOptions(ASPECT_RATIOS[currentKind] || [])
  }
  for (const v of values) {
    const opt = document.createElement('option')
    opt.value = v
    opt.textContent = v
    aspectMore.appendChild(opt)
  }
  // Cache the current allowed set for the pill click handler and
  // setAspectActive to consult.
  currentAspectValues = new Set(values)

  // If the current hidden-field value is no longer in `values`,
  // reset to the default. We don't auto-pick a different value
  // here because the user might be in the middle of editing —
  // refreshCapAdjustNotice is what flashes the warning.
  if (values.length > 0 && !values.includes(aspectHidden.value)) {
    // Try the per-kind default first; if that's also out, pick
    // the first allowed value.
    const fallback = values.includes(DEFAULT_ASPECT[currentKind])
      ? DEFAULT_ASPECT[currentKind]
      : values[0]
    aspectHidden.value = fallback
    setAspectActive(fallback)
  }
  // Mark pills that aren't in the model's enum. We use a class
  // for the visual (the .cap-auto-adjusted style adds a yellow
  // border + ⚠) AND set the data-cap-blocked attribute, which the
  // pill click handler consults to refuse the click.
  for (const pill of ratiosBar.querySelectorAll('.pill')) {
    const v = pill.dataset.value
    const supported = values.includes(v)
    pill.classList.toggle('cap-auto-adjusted', !supported)
    if (supported) {
      delete pill.dataset.capBlocked
      pill.removeAttribute('title')
    } else {
      pill.dataset.capBlocked = '1'
      pill.setAttribute('title', `${v} is not supported by this model — pick a different aspect ratio`)
    }
  }
  // Hide the "More…" dropdown if it adds nothing beyond the pills.
  const moreWrap = aspectMore.parentElement
  moreWrap.style.display = values.some(r => !QUICK_RATIOS.includes(r) && r !== 'auto') ? '' : 'none'
}

form.model.addEventListener('change', () => {
  applyCapabilitiesForModel(form.model.value)
})

// ---- show/hide image vs video fields ----
function refreshKindVisibility() {
  const kind = currentType() // "image" | "video"
  for (const el of form.querySelectorAll('[data-show]')) {
    el.style.display = el.dataset.show === kind ? '' : 'none'
  }
  // Disable hidden fields so they don't ride along in the form submission.
  for (const el of form.querySelectorAll('[data-show]')) {
    const hidden = el.dataset.show !== kind
    for (const inner of el.querySelectorAll('input, select, textarea')) {
      inner.disabled = hidden
    }
  }
}

// Resolution has two selects (image vs video) with the same name="resolution".
// We swap which one is enabled based on kind. The disabled one's value is
// already blank ("") by default, so it would override the active one if not
// for `disabled` excluding it from FormData.
function refreshResolutionSelect() {
  const kind = currentType()
  for (const sel of form.querySelectorAll('select[name=resolution]')) {
    sel.disabled = sel.dataset.resKind !== kind
  }
}

// ---- exact-size override (video only) ----
//
// The video options section has an `Exact size` field (input
// name="size", placeholder says "leave empty to use Aspect +
// Resolution"). When the user types a valid WxH string, that value
// overrides `aspect_ratio` and `resolution`: we disable those two
// fields so only `size` is sent on the wire, and we add the
// `is-overridden` class to the Aspect ratio section and to the
// resolution field's row so the user sees that those values won't
// take effect.
//
// When the field is empty, we restore everything to normal.
const sizeInput = document.getElementById('size_vid')
// Walk up from the hidden aspect_ratio input to find the enclosing
// <div class="section">. We don't use :has() so this works in every
// browser shipped in the last few years.
function sectionOf(el) {
  while (el && el !== form) {
    if (el.classList && el.classList.contains('section')) return el
    el = el.parentElement
  }
  return null
}
const aspectSection = sectionOf(document.getElementById('aspect_ratio'))
const resolutionField = form.querySelector('select[name=resolution][data-res-kind="video"]')?.closest('.field')
const resolutionSel = form.querySelector('select[name=resolution][data-res-kind="video"]')

function refreshSizeOverride() {
  // Only meaningful in video mode — in image mode the size field is
  // hidden anyway (data-show="video" on its wrapper).
  const kind = currentType()
  if (kind !== 'video') {
    if (aspectSection) aspectSection.classList.remove('is-overridden')
    if (resolutionField) resolutionField.classList.remove('is-overridden')
    if (aspectHidden) aspectHidden.disabled = false
    if (resolutionSel) resolutionSel.disabled = resolutionSel.dataset.resKind !== kind
    return
  }
  const v = sizeInput ? sizeInput.value.trim() : ''
  const active = v !== '' && sizePattern.test(v)
  // Visual feedback: dim the aspect / resolution rows so the user can
  // see at a glance which fields are being overridden.
  if (aspectSection) aspectSection.classList.toggle('is-overridden', active)
  if (resolutionField) resolutionField.classList.toggle('is-overridden', active)
  // Belt-and-suspenders: also disable the underlying form controls so
  // the FormData snapshot is guaranteed to omit them. (The browser
  // excludes disabled inputs from submission, so this is what makes
  // the override actually take effect on the wire.)
  if (aspectHidden) aspectHidden.disabled = active
  if (resolutionSel) resolutionSel.disabled = active || resolutionSel.dataset.resKind !== kind
}

if (sizeInput) sizeInput.addEventListener('input', refreshSizeOverride)

// ---- aspect-ratio pills + "More..." dropdown ----
function buildAspectRatioOptions(kind) {
  aspectMore.innerHTML = ''
  // Sort the static aspect-ratio list so the dropdown reads
  // "1:1, 2:3, 3:2, 3:4, …" instead of the hand-curated order in
  // ASPECT_RATIOS. Sentinels like "auto" sink to the bottom.
  const sorted = sortOptions(ASPECT_RATIOS[kind] || [])
  for (const v of sorted) {
    const opt = document.createElement('option')
    opt.value = v
    opt.textContent = v
    aspectMore.appendChild(opt)
  }
  aspectMore.value = ''
  // Hide the "More..." dropdown if it adds nothing beyond the pills.
  const moreWrap = aspectMore.parentElement
  moreWrap.style.display = sorted.some(r => !QUICK_RATIOS.includes(r) && r !== 'auto') ? '' : 'none'
}

function setAspectActive(value) {
  // Refuse to set a value the current model doesn't accept. This
  // happens if some other code path (or a stale UI) tries to set an
  // invalid value. We silently no-op rather than throwing because
  // the call sites don't expect a return value.
  if (value && currentAspectValues.size > 0 && !currentAspectValues.has(value)) {
    return
  }
  // Toggle pill states.
  for (const pill of ratiosBar.querySelectorAll('.pill')) {
    pill.classList.toggle('active', pill.dataset.value === value)
  }
  // Sync the hidden form field.
  aspectHidden.value = value || ''
  // If the value isn't on a quick-pick, set the "More..." dropdown to it
  // (and otherwise leave it empty so the dropdown doesn't show a stale value
  // that contradicts the active pill).
  if (value && !QUICK_RATIOS.includes(value) && ASPECT_RATIOS[currentKind].includes(value)) {
    aspectMore.value = value
  } else {
    aspectMore.value = ''
  }
}

for (const pill of ratiosBar.querySelectorAll('.pill')) {
  pill.addEventListener('click', () => {
    // Refuse the click if the pill is blocked for the current model.
    // (The visual ⚠ marker is set by applyAspectEnum via the
    // .cap-auto-adjusted class + data-cap-blocked attribute.) We
    // still want the click handler attached for non-blocked pills.
    if (pill.dataset.capBlocked) {
      // Briefly flash the pill so the user gets feedback that the
      // click was refused.
      pill.animate(
        [
          { transform: 'translateX(0)' },
          { transform: 'translateX(-3px)' },
          { transform: 'translateX(3px)' },
          { transform: 'translateX(0)' },
        ],
        { duration: 120 }
      )
      return
    }
    setAspectActive(pill.dataset.value)
  })
}
aspectMore.addEventListener('change', () => setAspectActive(aspectMore.value))

// ---- main refresh when type changes ----
function refreshAll() {
  const kind = currentType() // "image" | "video"
  currentKind = kind
  buildAspectRatioOptions(kind)
  // Always set the per-kind default. setAspectActive is a no-op for the
  // active pill state if the hidden field already has the same value, so
  // it's safe to call every time.
  setAspectActive(DEFAULT_ASPECT[kind] || '')
  refreshModelOptions()
  refreshKindVisibility()
  refreshResolutionSelect()
  refreshSizeOverride()
  refreshRefHint()
  // Re-apply the cached capabilities for the currently-selected model.
  // We deliberately do NOT re-fetch — the model's supported_params
  // don't depend on whether the user is generating an image or a
  // video. If the cache is cold (first switch after page load, before
  // the initial fetch resolved), the apply is a no-op and the
  // initial applyCapabilitiesForModel call from the on-load IIFE will
  // populate the form when the response arrives.
  const mid = form.model.value
  if (mid && modelCapabilitiesCache.has(mid)) {
    applyCapabilitiesFromData(modelCapabilitiesCache.get(mid))
  } else if (mid) {
    // Cold cache: trigger a fetch. This is the same path the model
    // change listener uses, so we don't duplicate the fetch logic.
    applyCapabilitiesForModel(mid)
  } else {
    applyCapabilitiesFromData(null)
  }
}

for (const radio of form.querySelectorAll('input[name=type]')) {
  radio.addEventListener('change', () => {
    refreshAll()
    // Re-render so the First/Last frame badges reflect the new mode.
    if (refInput.files && refInput.files.length > 0) renderRefPreview()
  })
}

// ---- reference image thumbnails ----
function renderRefPreview() {
  // Revoke any previously-issued object URLs to avoid leaks.
  for (const url of refObjectURLs) URL.revokeObjectURL(url)
  refObjectURLs = []

  const files = refInput.files ? Array.from(refInput.files) : []
  refPreview.innerHTML = ''
  if (files.length === 0) {
    refPreview.hidden = true
    return
  }
  refPreview.hidden = false

  const n = files.length
  const isVideo = currentType() === 'video'
  for (let i = 0; i < n; i++) {
    const file = files[i]
    const url = URL.createObjectURL(file)
    refObjectURLs.push(url)

    const thumb = document.createElement('div')
    thumb.className = 'ref-thumb'

    // Image wrapper — contains the <img> plus the absolutely-positioned
    // overlays (idx pill, role badge, remove button). The name strip
    // lives as a sibling below this wrapper so it has its own row and
    // can show the full filename (wrapping if needed, selectable for
    // copy-to-clipboard).
    const imgWrap = document.createElement('div')
    imgWrap.className = 'ref-img'

    const img = document.createElement('img')
    img.src = url
    img.alt = file.name || `Reference ${i + 1}`
    img.loading = 'lazy'
    imgWrap.appendChild(img)

    // Index pill (top-left) shows position in the list.
    const idx = document.createElement('span')
    idx.className = 'idx'
    idx.textContent = `#${i + 1}`
    imgWrap.appendChild(idx)

    // Role badge (bottom-left) — only meaningful for video (i2v), where the
    // SDK distinguishes first_frame vs last_frame. For image refs we skip
    // the badge entirely; the file name is enough.
    if (isVideo) {
      let label = null
      if (n >= 2 && i === n - 1) label = 'Last frame'
      else if (i === 0) label = 'First frame'
      if (label) {
        const badge = document.createElement('span')
        badge.className = 'badge'
        badge.textContent = label
        imgWrap.appendChild(badge)
      }
    }

    // Remove button (top-right over the image) — only visible on hover.
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'remove'
    remove.setAttribute('aria-label', `Remove ${file.name || 'reference ' + (i + 1)}`)
    remove.textContent = '\u2715'
    remove.addEventListener('click', (ev) => {
      ev.preventDefault()
      removeRefAt(i)
    })
    imgWrap.appendChild(remove)

    // Image on top, filename strip below — append the image wrapper
    // first, then the name, so the flex column renders in the right
    // order (image → name).
    thumb.appendChild(imgWrap)

    // File name — always shown, full text (no ellipsis), wraps to
    // multiple lines if needed, and is selectable so the user can copy
    // it to the clipboard.
    const name = document.createElement('span')
    name.className = 'name'
    name.title = file.name || '' // full name on hover
    name.textContent = file.name || `Reference ${i + 1}`
    thumb.appendChild(name)

    refPreview.appendChild(thumb)
  }
}

// Remove the i-th reference from the file input and re-render.
function removeRefAt(i) {
  if (!refInput.files || i < 0 || i >= refInput.files.length) return
  const dt = new DataTransfer()
  const files = Array.from(refInput.files)
  for (let j = 0; j < files.length; j++) {
    if (j !== i) dt.items.add(files[j])
  }
  refInput.files = dt.files
  refreshRefHint()
  renderRefPreview()
}

refInput.addEventListener('change', () => {
  // If the user picked more than the per-model cap, we keep their full
  // selection (don't silently drop — that would surprise them) and
  // surface the error via refreshRefHint. The user can then remove
  // files from the preview grid until they're under the cap.
  refreshRefHint()
  renderRefPreview()
})

// ---- first/last frame anchor previews (video only) ----
//
// Each frame input has a sibling `.frame-preview` div that we populate
// with an image + a selectable filename. Object URLs are tracked so we
// can revoke them when the file changes (no leaks).
const frameFirstInput  = document.getElementById('frame_first')
const frameLastInput   = document.getElementById('frame_last')
const frameFirstPrev   = document.getElementById('frame_first_preview')
const frameLastPrev    = document.getElementById('frame_last_preview')
const frameObjectURLs  = { first: null, last: null }

function renderFramePreview(inputEl, previewEl, slot /* 'first' | 'last' */) {
  // Revoke any previous object URL for this slot.
  if (frameObjectURLs[slot]) {
    URL.revokeObjectURL(frameObjectURLs[slot])
    frameObjectURLs[slot] = null
  }
  previewEl.innerHTML = ''
  const file = inputEl.files && inputEl.files[0]
  if (!file) {
    previewEl.hidden = true
    return
  }
  previewEl.hidden = false

  const url = URL.createObjectURL(file)
  frameObjectURLs[slot] = url

  const img = document.createElement('img')
  img.src = url
  img.alt = file.name || `Frame ${slot}`
  previewEl.appendChild(img)

  // Bottom filename strip — full name, selectable so the user can
  // copy it to the clipboard. We let it wrap to multiple lines and
  // use a monospace font so the layout is predictable.
  const name = document.createElement('span')
  name.className = 'name'
  name.textContent = file.name || ''
  name.title = file.name || ''
  previewEl.appendChild(name)

  // Remove button — clears the file input and re-renders.
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'remove'
  remove.setAttribute('aria-label', `Remove ${file.name || 'frame'}`)
  remove.textContent = '×'
  remove.addEventListener('click', (ev) => {
    ev.preventDefault()
    inputEl.value = '' // clear the file input
    renderFramePreview(inputEl, previewEl, slot)
  })
  previewEl.appendChild(remove)
}

if (frameFirstInput && frameFirstPrev) {
  frameFirstInput.addEventListener('change', () => renderFramePreview(frameFirstInput, frameFirstPrev, 'first'))
}
if (frameLastInput && frameLastPrev) {
  frameLastInput.addEventListener('change', () => renderFramePreview(frameLastInput, frameLastPrev, 'last'))
}

// On load: fetch the model list
;(async () => {
  try {
    const m = await fetch('/api/models').then(r => r.json())
    models = m
    refreshAll()
    setAspectActive(DEFAULT_ASPECT[currentKind] || '1:1') // ensure default state
    // Now that the model dropdown has its initial value, ask the
    // server what that model supports and dim unsupported fields.
    applyCapabilitiesForModel(form.model.value)
  } catch (err) {
    setStatus('error', `Failed to initialize: ${err.message}`)
  }
})()

// ---- submit ----

// Map server `code` values to a short emoji prefix. Keep this in sync with
// the errCode* constants in main.go.
const ERROR_ICON = {
  auth: '🔑',
  quota: '💸',
  rate_limit: '⏳',
  unsupported_fields: '🚫',
  bad_request: '⚠️',
  moderation: '🛑',
  upstream: '☁️',
  network: '🌐',
  video_failed: '🎬',
  internal: '❌',
}

// Remember the most recent failed request so the "Retry" button can
// resubmit it without the user re-filling the form. Cleared on success.
let lastFailedRequest = null
let lastFailedFields = null   // unsupportedFields from the last error, if any

// Show an error in the status bar. `opts.retryable` and
// `opts.unsupportedFields` add a button.
function showGenError(body) {
  const icon = ERROR_ICON[body.code] || '❌'
  const retryable = !!body.retryable
  const fields = Array.isArray(body.unsupportedFields) ? body.unsupportedFields : []

  // Build the message. We append a short "Retry" hint when the user can act.
  let msg = `${icon} ${body.error || 'Unknown error'}`
  if (fields.length > 0) {
    msg += `\n   Disabling: ${fields.join(', ')}`
  }
  setStatus('error', msg)

  // Append a Retry button (without nuking the message). We rebuild the
  // status node's children to keep the text node and the button side by side.
  if (retryable) {
    const existing = status.querySelector('.retry-btn')
    if (existing) existing.remove()
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'retry-btn'
    btn.textContent = fields.length > 0 ? '↻ Retry without these fields' : '↻ Retry'
    btn.style.cssText = 'margin-left:10px;font:inherit;font-size:12px;padding:3px 10px;border:0;border-radius:6px;background:var(--surface-3);color:var(--text);cursor:pointer;'
    btn.addEventListener('click', () => {
      // Two flavors of retry:
      //  - The model rejected some fields: we want to send the SAME body
      //    minus those fields. Snapshot + disable + resubmit.
      //  - The provider was down / rate-limited: the user may have edited
      //    the form in the meantime, so just resubmit whatever the form
      //    has now.
      if (fields.length > 0) {
        disableFields(fields)
        submitGenerate({ isRetry: true, resendSnapshot: true })
      } else {
        submitGenerate({ isRetry: true, resendSnapshot: false })
      }
    })
    status.appendChild(btn)
  }
}

// Disable the named form fields (and their inner inputs) so the next
// FormData build excludes them. Used when the server tells us the model
// rejected some params.
function disableFields(names) {
  for (const name of names) {
    // Match by `name=` (covers all <input>, <select>, <textarea> with
    // that attribute) and also the dedicated id-based controls.
    for (const el of form.querySelectorAll(`[name="${CSS.escape(name)}"]`)) {
      el.disabled = true
    }
    // Special: the reference image file input has name="ref", handled above.
    // Special: frame_first / frame_last are file inputs with the matching name.
    // Special: the aspect_ratio dropdown also writes to a hidden field with
    // the same name; disabling the dropdown disables the user-facing control
    // but the hidden field still has its value — that's fine, FormData
    // includes hidden disabled inputs? It does NOT — disabled inputs are
    // excluded from form submission, same as a select. So we need to clear
    // the hidden aspect_ratio field if the server says aspect_ratio is
    // unsupported.
    if (name === 'aspect_ratio' && aspectHidden) aspectHidden.value = ''
    if (name === 'generate_audio') {
      const cb = form.querySelector('input[name="generate_audio"]')
      if (cb) cb.checked = false
    }
    if (name === 'n') {
      const n = form.querySelector('input[name="n"]')
      if (n) n.value = '1'
    }
    if (name === 'seed') {
      const s = form.querySelector('input[name="seed"]')
      if (s) s.value = ''
    }
    if (name === 'output_compression') {
      const c = form.querySelector('input[name="output_compression"]')
      if (c) c.value = '100'
    }
    if (name === 'duration') {
      const d = form.querySelector('input[name="duration"]')
      if (d) d.value = '5'
    }
    if (name === 'size') {
      // Server says the model doesn't support `size`. The natural
      // fallback is to clear the override so the user goes back to
      // using aspect_ratio + resolution, which are universally
      // supported.
      const sz = form.querySelector('input[name="size"]')
      if (sz) sz.value = ''
      refreshSizeOverride()
    }
  }
  // Re-run a couple of UI refreshes so the disabled state is visible
  // (e.g. the reference picker goes muted).
  refreshKindVisibility()
  refreshResolutionSelect()
  refreshRefHint()
}

// Build a small "Download ⬇ / Open ↗" bar to drop under a generated preview.
// The `download` attribute on the anchor is what makes the browser save the
// file with the original name (instead of routing to the in-page video
// element) when the user clicks Download. "Open in new tab" is for the case
// where the user wants to grab a different-format copy later.
function buildDownloadBar(url, path) {
  const bar = document.createElement('div')
  bar.className = 'download-bar'

  const a = document.createElement('a')
  a.className = 'download-btn'
  a.href = url
  a.download = path || ''
  a.textContent = '⬇ Download'
  bar.appendChild(a)

  const open = document.createElement('a')
  open.className = 'download-btn download-btn--ghost'
  open.href = url
  open.target = '_blank'
  open.rel = 'noopener'
  open.textContent = '↗ Open'
  bar.appendChild(open)

  // Tiny path hint so the user can see the on-disk filename without opening
  // a terminal. Truncated in CSS for very long paths.
  const hint = document.createElement('span')
  hint.className = 'download-hint'
  hint.title = path || ''
  hint.textContent = `ai_outputs/${path || ''}`
  bar.appendChild(hint)

  return bar
}

// Submit helper. `opts.isRetry` is true when called from the Retry button.
// `opts.resendSnapshot` is true when we want to re-send the *exact* body
// that previously failed (after disabling some fields), false when the
// user has since edited the form and we should re-serialize.
async function submitGenerate(opts = {}) {
  const { isRetry = false, resendSnapshot = false } = opts
  preview.innerHTML = ''
  button.disabled = true
  // Clear any previous retry button before showing the new status.
  const oldBtn = status.querySelector('.retry-btn')
  if (oldBtn) oldBtn.remove()
  setStatus('generating', isRetry ? 'Retrying... 🔁' : 'Submitting to OpenRouter... 🚀')

  let data
  if (isRetry && resendSnapshot && lastFailedRequest) {
    // We disabled the offending fields in the form, but the FormData
    // snapshot was built BEFORE that disable. Re-build a fresh FormData
    // from the form so the disabled fields are excluded — the user's
    // other edits since the original failure are also picked up here.
    data = new FormData(form)
  } else if (isRetry) {
    // Plain retry (no field removal). Reserialize from the form so any
    // edits the user made are respected.
    data = new FormData(form)
  } else {
    // First attempt: build FormData from a fresh form snapshot so
    // disabled fields are excluded.
    data = new FormData(form)
  }
  // Always remember the body we're about to send so a future
  // "Retry without these fields" can re-send it after disabling.
  lastFailedRequest = data
  lastFailedFields = null

  try {
    const res = await fetch('/api/generate', { method: 'POST', body: data })
    // Parse body as JSON regardless of status — the server always returns
    // our genError shape on failure.
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      lastFailedFields = Array.isArray(body.unsupportedFields) ? body.unsupportedFields : null
      throw body  // pass the whole body to the catch block
    }
    // Success — clear the failure memo so the form is fully re-serialized
    // on the next submit.
    lastFailedRequest = null
    lastFailedFields = null

    if (body.kind === 'image') {
      setStatus('done', `Saved: ${body.path}`)
      const img = document.createElement('img')
      img.src = body.url
      img.alt = 'Generated image'
      preview.appendChild(img)
      preview.appendChild(buildDownloadBar(body.url, body.path))
    } else if (body.kind === 'video') {
      setStatus('done', `✅ Saved: ${body.path}`)
      const video = document.createElement('video')
      video.src = body.url
      video.controls = true
      video.autoplay = true
      preview.appendChild(video)
      preview.appendChild(buildDownloadBar(body.url, body.path))
    }
  } catch (err) {
    // err may be our parsed body object (from `throw body`) or a network
    // error. Normalize to the genError shape.
    const body = (err && typeof err === 'object' && (err.error || err.code))
      ? err
      : { error: (err && err.message) || String(err), code: 'internal', retryable: false }
    showGenError(body)
  } finally {
    button.disabled = false
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault()
  submitGenerate({ isRetry: false, resendSnapshot: false })
})