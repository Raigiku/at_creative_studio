// components/capFields.js — shared cap-aware form controls.
//
// Both ImageOptions and VideoOptions need a <select>, a number input,
// and (for video) a checkbox that follow the active model's
// capabilities. They used to each declare private copies of these
// helpers; this module is the single home.
//
// All three take a `view` (the result of deriveView(capabilities))
// and look up whether the named field is supported. Under the
// "exclusive" policy (see capabilities.js), unsupported fields
// are HIDDEN ENTIRELY — the form doesn't render the row at all.
//
// Also exports FIELD_FALLBACKS — the per-field static option lists
// used by the renderer (when the model has no capabilities block,
// the static defaults apply) and the clamp-on-model-change loop
// in App.js.

import { h } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import htm from 'htm'
import { optionsFor, rangeFor, narrowedOptionsFor } from '../capabilities.js'

const html = htm.bind(h)

// Field-id → human-readable label, used by CapSelect's constraint
// help line so the user sees "Required because Compression is set"
// rather than "Required because output_compression is set". Pulled
// from FORM_FIELD_KIND in fieldConfig.js when available, falling
// back to the field name.
const FIELD_LABELS = {
  aspect_ratio: 'Aspect ratio',
  background: 'Background',
  output_format: 'Format',
  quality: 'Quality',
  resolution: 'Resolution',
  n: 'Number of images',
  output_compression: 'Compression',
  seed: 'Seed',
  duration: 'Duration',
  size: 'Size',
  frame_first: 'First frame',
  frame_last: 'Last frame',
  generate_audio: 'Generate audio',
}

// Per-field option fallbacks. Used by the renderer when the model
// has no capabilities block (every field is shown with the static
// list), and by App.js's clamp loop to pick a valid value when
// the old one is no longer in the new allowlist.
export const FIELD_FALLBACKS = {
  output_format: ['png', 'jpeg', 'webp', 'svg'],
  quality:       ['auto', 'low', 'medium', 'high'],
  background:    ['auto', 'transparent', 'opaque'],
  resolution:    ['512', '1K', '2K', '4K'],
  duration:      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
}

// A single cap-aware <select> row. `fallback` is the per-field option
// list from FIELD_FALLBACKS; used when the model has no
// capabilities block (view is null). Returns null when the field
// is hidden by the active model's capabilities.
//
// Constraint narrowing: when the active model has a constraint
// where `requires.field === name` AND the constraint's `if_set`
// field is currently non-empty, the dropdown's options are
// replaced with the constraint's `requires.in` list. A small help
// line under the label explains which field triggered the
// narrowing (e.g. "Required because Compression is set"). The
// option list is kept in YAML order (not sorted) so "jpeg" comes
// first when the rule says "in: [jpeg, webp]".
export function CapSelect({ name, label, fallback, view }) {
  if (view && view[name] && !view[name].supported) return null
  // Subscribe to form-wide change events so this <select>
  // re-renders when an `if_set` field elsewhere in the form
  // changes (e.g. the user types in `output_compression`, which
  // narrows this field's `output_format` dropdown to [jpeg, webp]).
  // The form's own change handler (enforceConstraints in App.js)
  // runs first and mutates the select's value to a valid one if
  // needed; we re-render here so the user sees the new option
  // list.
  const [, force] = useState(0)
  useEffect(() => {
    const form = document.getElementById('gen-form')
    if (!form) return
    const onAnyChange = () => force(x => x + 1)
    form.addEventListener('change', onAnyChange)
    form.addEventListener('input', onAnyChange)
    return () => {
      form.removeEventListener('change', onAnyChange)
      form.removeEventListener('input', onAnyChange)
    }
  }, [])

  // Read the current form values so narrowedOptionsFor can decide
  // whether the constraint applies right now. We collect every
  // named field's value, not just the constraint's `if_set` — the
  // helper walks the constraints array and needs the full snapshot.
  const formValues = readFormValues('gen-form')

  // Constraint narrowing wins when active. Otherwise fall back to
  // the model's static enum values (or the per-field fallback).
  const { options: narrowed, narrowedBy } = narrowedOptionsFor(view, name, formValues)
  let opts
  if (narrowed) {
    opts = narrowed
  } else {
    const all = optionsFor(view, name, fallback) || []
    opts = all
  }
  if (opts.length === 0) return null

  const help = narrowedBy
    ? `(only ${opts.join(', ')} — required because ${FIELD_LABELS[narrowedBy] || narrowedBy} is set)`
    : null

  return html`
    <div class="field" data-cap-name=${name}>
      <label class="section-label" for=${name}>
        ${label} ${help && html`<span class="help">${help}</span>`}
      </label>
      <select
        id=${name}
        name=${name}
        data-cap-name=${name}
        data-narrowed-by=${narrowedBy || ''}
      >
        ${opts.map(v => html`<option key=${v} value=${v}>${v}</option>`)}
      </select>
    </div>
  `
}

// readFormValues — snapshot every named form element's current
// value. Used by CapSelect to evaluate per-model constraints
// without coupling to the App.js state shape. Returns an object
// mapping `name` → value (string). Files are skipped — their
// value is the file name, which we don't surface as a constraint
// trigger today. Boolean checkboxes are "on" or "" (the same
// string the form would submit).
function readFormValues(formID) {
  const form = typeof document !== 'undefined' ? document.getElementById(formID) : null
  if (!form) return {}
  const out = {}
  for (const el of form.elements) {
    if (!el || !el.name) continue
    if (el.type === 'file') continue
    if (el.type === 'checkbox' || el.type === 'radio') {
      if (!el.checked) continue
      out[el.name] = el.value || 'on'
    } else {
      out[el.name] = String(el.value || '')
    }
  }
  return out
}

// A single cap-aware <input type=number> row. Min/max come from the
// view; help text reflects the bounds. The `min` and `max` props
// are the static defaults to use when the model has no
// capabilities block. Returns null when the field is hidden by
// the active model.
export function CapNumberInput({ name, label, help, min, max, value, view }) {
  if (view && view[name] && !view[name].supported) return null
  const r = rangeFor(view, name)
  const lo = (r && r.min !== null) ? r.min : (min || '')
  const hi = (r && r.max !== null) ? r.max : (max || '')
  const resolvedHelp = rangeHelp(view, name, help)
  return html`
    <div class="field" data-cap-name=${name}>
      <label class="section-label" for=${name}>
        ${label} ${resolvedHelp && html`<span class="help">${resolvedHelp}</span>`}
      </label>
      <input
        type="number"
        class="input"
        id=${name}
        name=${name}
        data-cap-name=${name}
        min=${lo}
        max=${hi}
        step="1"
        value=${value}
      />
    </div>
  `
}

// A single cap-aware <input type=checkbox> row. Returns null when
// the field is hidden by the active model.
export function CapCheckbox({ name, label, view }) {
  if (view && view[name] && !view[name].supported) return null
  return html`
    <div class="field" data-cap-name=${name}>
      <label class="check" for=${name}>
        <input
          type="checkbox"
          id=${name}
          name=${name}
          data-cap-name=${name}
        />
        ${label}
      </label>
    </div>
  `
}

// Range help text. Returns "(1–10)", "(5)" (when min==max), or the
// caller's static help when the view has no range info.
function rangeHelp(view, name, fallback) {
  if (!view) return fallback
  const r = rangeFor(view, name)
  if (!r || r.min === null || r.max === null) return fallback
  if (r.min === r.max) return `(${r.min})`
  return `(${r.min}–${r.max})`
}
