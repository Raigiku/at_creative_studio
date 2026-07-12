// capabilities.js — derive a "form view" from the active model.
//
// Given `state.capabilities`, returns an object describing how each
// form field should be rendered. Components read this once per
// render and apply it to their <select>/<input> children.
//
// Returns null when no model is selected (the caller should fall
// back to the static HTML defaults).

import { sortOptions } from './sort.js'
import { FORM_NAME_TO_CAP_NAME, FORM_FIELD_KIND } from './fieldConfig.js'

// Build a per-field view from a capabilities blob. Pure function.
export function deriveView(cap) {
  if (!cap) return null
  const supported = new Set(cap.supported_params || [])
  const details = cap.param_details || null
  const view = {}
  for (const [formName, capName] of Object.entries(FORM_NAME_TO_CAP_NAME)) {
    const fc = FORM_FIELD_KIND[formName]
    if (!fc) continue
    const detail = details ? details[capName] : null
    const isSupported = supported.size === 0 ? true : supported.has(capName)
    view[formName] = {
      supported: isSupported,
      detail,
      kind: fc.kind,
    }
  }
  // Per-model ref cap.
  const ir = details && details.input_references
  if (ir && ir.type === 'range' && typeof ir.max === 'number' && ir.max > 0) {
    view._refMax = Math.floor(ir.max)
  } else {
    view._refMax = null
  }
  view._quirks = cap.quirks || []
  return view
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
