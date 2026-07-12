// capabilities.js — derive a "form view" from the active model.
//
// Given `state.capabilities` (the response from /api/models/{id}),
// returns an object describing how each form field should be rendered.
// Components read this once per render and apply it to their
// <select>/<input> children.
//
// Two cases for `state.capabilities`:
//
//   - `null` (model has no capabilities block in models.yaml) →
//     deriveView returns a view with every FORM_NAME_TO_CAP_NAME
//     entry marked `supported: true`. The components fall back
//     to their static HTML defaults (every field enabled,
//     FIELD_FALLBACKS for enums).
//
//   - an object with `fields` and `constraints` (from models.yaml) →
//     deriveView walks FORM_NAME_TO_CAP_NAME, looks up each field
//     in `cap.fields`, and produces a per-field view entry. Fields
//     ABSENT from `cap.fields` are `supported: false` — the form
//     hides them entirely. This is the "exclusive" policy: a
//     model's YAML block is the complete list of fields it exposes.
//
// JSON contract (what the server sends):
//
//   {
//     "fields": {
//       "output_format": { "enabled": true,  "type": "enum",  "values": ["png","jpeg","webp"] },
//       "n":             { "enabled": true,  "type": "range", "min": 1, "max": 10 },
//       "resolution":    { "enabled": false }                       // hidden
//     },
//     "constraints": [
//       { "if_set": "output_compression",
//         "requires": { "field": "output_format", "in": ["jpeg","webp"] },
//         "message": "..." }
//     ]
//   }

import { sortOptions } from './sort.js'
import { FORM_NAME_TO_CAP_NAME, FORM_FIELD_KIND } from './fieldConfig.js'

// Build a per-field view from a capabilities blob. Pure function.
export function deriveView(cap) {
  const fields = (cap && cap.fields) || {}
  const view = {}
  for (const [formName, capName] of Object.entries(FORM_NAME_TO_CAP_NAME)) {
    const fc = FORM_FIELD_KIND[formName]
    if (!fc) continue
    const fieldCap = fields[capName] // may be undefined
    if (!cap) {
      // Model has no capabilities block: every known field is
      // supported with static defaults. The components fall back
      // to FIELD_FALLBACKS for enums and the caller-provided
      // min/max for ranges.
      view[formName] = { supported: true, detail: null, kind: fc.kind }
      continue
    }
    // Model has a capabilities block. Fields absent from the
    // block are hidden entirely (the "exclusive" policy — the
    // block is the complete list of fields this model exposes).
    if (!fieldCap) {
      view[formName] = { supported: false, detail: null, kind: fc.kind }
      continue
    }
    const supported = fieldCap.enabled !== false
    // detail mirrors the server's paramDetail shape so the
    // downstream components (optionsFor / rangeFor) don't need to
    // know which format the server emits.
    const detail = capFieldToDetail(fieldCap)
    view[formName] = { supported, detail, kind: fc.kind }
  }
  // Per-model ref cap. Only meaningful when the model has a
  // capabilities block (otherwise the server uses its default).
  if (cap) {
    const ir = fields.input_references
    if (ir && ir.type === 'range' && typeof ir.max === 'number' && ir.max > 0) {
      view._refMax = Math.floor(ir.max)
    } else {
      view._refMax = null
    }
    view._constraints = Array.isArray(cap.constraints) ? cap.constraints : []
  } else {
    view._refMax = null
    view._constraints = []
  }
  return view
}

// capFieldToDetail flattens a YAML field cap into the paramDetail
// shape components expect (Type/Values/Min/Max).
function capFieldToDetail(fc) {
  if (!fc || typeof fc !== 'object') return null
  if (fc.type === 'enum') {
    return { type: 'enum', values: Array.isArray(fc.values) ? fc.values : [] }
  }
  if (fc.type === 'range') {
    return {
      type: 'range',
      min: typeof fc.min === 'number' ? fc.min : null,
      max: typeof fc.max === 'number' ? fc.max : null,
    }
  }
  if (fc.type === 'boolean') {
    return { type: 'boolean' }
  }
  // 'text' or anything else: no structured detail. The renderer
  // will show the field as a free-form input.
  return { type: fc.type || 'text' }
}

// Resolve a select's options for the current view, falling back to
// the provided defaults. Returns the sorted option list.
export function optionsFor(view, fieldName, fallback) {
  if (!view) return sortOptions(fallback || [])
  const f = view[fieldName]
  if (!f || !f.supported) {
    // Field is unsupported by this model: empty list, the UI will
    // dim the wrapper and the form will not include the field.
    return []
  }
  if (f.kind === 'enum' || (f.kind === 'enum_or_range' && f.detail && f.detail.type === 'enum')) {
    const v = f.detail && Array.isArray(f.detail.values) ? f.detail.values : []
    return v.length > 0 ? sortOptions(v) : sortOptions(fallback || [])
  }
  if (f.kind === 'range' || (f.kind === 'enum_or_range' && f.detail && f.detail.type === 'range')) {
    // Range fields use <input type=number>; the relevant values are
    // just the min/max.
    return null
  }
  if (f.kind === 'aspect_enum') {
    return null // handled by the Aspect component
  }
  return sortOptions(fallback || [])
}

// fieldIsSetJS — JS mirror of the Go-side `fieldIsSet` rule. A
// field is "set" when its value is non-empty AND not "0". This
// keeps the UI's view of "compression = 0 means unset" in sync
// with the server's, so the constraint doesn't fire for a
// compression value of 0.
function fieldIsSetJS(value) {
  const v = String(value || '').trim()
  if (v === '' || v === '0') return false
  return true
}

// Resolve a select's options after applying per-model cross-field
// constraints. Returns:
//
//   { options, narrowedBy }   — `options` is the effective list to
//                               render; `narrowedBy` is the rule's
//                               `if_set` field name when narrowing
//                               is active (used to render a help
//                               line under the dropdown).
//   { options: null, narrowedBy: null }  — no narrowing applies; the
//                                          caller falls back to
//                                          optionsFor().
//
// `formValues` maps field name (as it appears in the form) → current
// value (string, or "" for unset). A field is "set" when its value
// is non-empty AND not "0" (mirroring the Go-side "non-zero"
// semantic; see fieldIsSetJS).
//
// Narrowing is purely declarative: when a constraint's `if_set`
// field is currently set AND its `requires.field` matches the
// field we're rendering, the rendered options are the constraint's
// `requires.in` list. The values are returned in the order the YAML
// declares them (sorted only when no narrowing applies — preserving
// the YAML's ordering keeps the help text "jpeg or webp" in sync
// with the dropdown's first/second options).
export function narrowedOptionsFor(view, fieldName, formValues) {
  if (!view || !Array.isArray(view._constraints) || view._constraints.length === 0) {
    return { options: null, narrowedBy: null }
  }
  const values = formValues || {}
  for (const c of view._constraints) {
    if (!c || !c.requires || c.requires.field !== fieldName) continue
    if (!fieldIsSetJS(values[c.if_set])) continue
    const allowed = Array.isArray(c.requires.in) ? c.requires.in : []
    if (allowed.length === 0) continue
    return { options: allowed.slice(), narrowedBy: c.if_set }
  }
  return { options: null, narrowedBy: null }
}

export function rangeFor(view, fieldName) {
  if (!view) return null
  const f = view[fieldName]
  if (!f || !f.supported) return null
  if (f.kind === 'range' || f.kind === 'enum_or_range') {
    if (f.detail && f.detail.type === 'range') {
      return {
        min: f.detail.min !== undefined && f.detail.min !== null ? String(f.detail.min) : null,
        max: f.detail.max !== undefined && f.detail.max !== null ? String(f.detail.max) : null,
      }
    }
  }
  return null
}

// applyConstraints walks the view's constraints and returns the
// first violation's message, or "" if every rule passes. The
// caller is expected to use it on submit and after any user
// input that could change a constrained field's value.
//
// `formValues` is an object mapping field name (as it appears in
// the form) → current value (string, or "" for unset). A field
// is "set" if its value is non-empty after trimming. Booleans
// come through as the strings "on"/"true" or "".
export function applyConstraints(view, formValues) {
  if (!view || !Array.isArray(view._constraints)) return ''
  for (const c of view._constraints) {
    if (!c) continue
    const ifSet = (formValues[c.if_set] || '').trim()
    if (!ifSet) continue
    const required = (formValues[c.requires && c.requires.field] || '').trim()
    const allowed = (c.requires && Array.isArray(c.requires.in)) ? c.requires.in : []
    const requiredLower = required.toLowerCase()
    let ok = false
    for (const v of allowed) {
      if (String(v).toLowerCase() === requiredLower) { ok = true; break }
    }
    if (!ok) {
      return c.message || `invalid combination: ${c.if_set} requires ${c.requires && c.requires.field} in [${allowed.join(', ')}]`
    }
  }
  return ''
}
