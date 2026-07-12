// modules/capabilities.js
//
// The model list, the per-model capabilities fetch/apply, the
// FORM_NAME_TO_CAP_NAME / FORM_FIELD_KIND tables, and the helpers
// that rebuild <select> options, dim unsupported fields, and update
// the help text.
//
// Public API:
//
//   initCapabilities({ onApplied })  — wire up the model-select
//                                       'change' listener and install
//                                       any global handlers.
//   getModels()                       — { image: [...], video: [...] }
//   setModels(m)                      — set the in-memory model list
//   refreshModelOptions()             — repopulate the model <select>
//   applyCapabilitiesForModel(id)     — fetch+apply for one model
//   applyCapabilitiesFromData(cap)    — pure re-apply (used by orchestrator)
//
// State:
//   modelCapabilitiesCache — Map<modelID, capabilityResponse>. Shared
//                            across all callers. Cleared implicitly
//                            (we don't clear it; the server's cache
//                            is hour-long anyway).
//   capabilitiesInflight   — dedupes concurrent fetches.

import {
  getForm,
  getCapHint,
} from './dom.js'
import { setStatus } from './status.js'
import { sortOptions } from './sort.js'
import {
  applyAspectEnum,
  unblockAllPills,
} from './aspect.js'
import {
  refreshKindVisibility,
  refreshResolutionSelect,
} from './kind.js'
import {
  refreshRefHint,
  getCurrentRefMax,
  setCurrentRefMax,
  getMAX_REFS,
} from './references.js'

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
  const form = getForm()
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

function refreshCapHint(quirks) {
  const capHintEl = getCapHint()
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

function applyParamDetails(paramDetails) {
  const form = getForm()
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
  // form reference only used to silence "unused" lint
  void form
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
  const form = getForm()
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
  const form = getForm()
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

// In-memory model list. Populated by the orchestrator on startup
// from /api/models. Indexed by kind ("image" | "video").
let models = { image: [], video: [] }

export function getModels() { return models }
export function setModels(m) { models = m }

let _onApplied = () => {}

// Per-model capabilities cache. Keyed by the full model id
// (e.g. "x-ai/grok-imagine-image-quality"). The server caches the
// same response for an hour, so re-applying locally is free and
// switching image/video never re-fetches.
const modelCapabilitiesCache = new Map()
let capabilitiesInflight = null  // dedupes concurrent fetches

export function initCapabilities({ onApplied } = {}) {
  _onApplied = onApplied || _onApplied
  const form = getForm()
  form.model.addEventListener('change', () => {
    applyCapabilitiesForModel(form.model.value)
  })
}

// ---- model dropdown ----
export function refreshModelOptions() {
  const form = getForm()
  const type = form.type.value // "image" | "video"
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

export async function applyCapabilitiesForModel(modelID) {
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
export function applyCapabilitiesFromData(cap) {
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
    setCurrentRefMax(getMAX_REFS())
    // Reset aspect-ratio state to the static fallback so the
    // initial pills are clickable.
    unblockAllPills()
    refreshRefHint()
    refreshKindVisibility()
    refreshResolutionSelect()
    _onApplied()
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
    setCurrentRefMax(Math.floor(ir.max))
  } else {
    setCurrentRefMax(getMAX_REFS())
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
  refreshKindVisibility()
  refreshResolutionSelect()
  _onApplied()
}
