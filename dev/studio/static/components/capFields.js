// components/capFields.js — shared cap-aware form controls.
//
// Both ImageOptions and VideoOptions need a <select>, a number input,
// and (for video) a checkbox that follow the active model's
// capabilities. They used to each declare private copies of these
// helpers; this module is the single home.
//
// All three take a `view` (the result of deriveView(capabilities))
// and look up whether the named field is supported. Unsupported
// fields get the .cap-unsupported class and are disabled.
//
// Also exports FIELD_FALLBACKS — the per-field static option lists
// used by both the renderer (when the model doesn't enumerate the
// field) and the clamp-on-model-change loop in App.js.

import { h } from 'preact'
import htm from 'htm'
import { optionsFor, rangeFor } from '../capabilities.js'
import { cx } from '../helpers.js'

const html = htm.bind(h)

// Per-field option fallbacks. Used by the renderer when the model
// doesn't enumerate the field, and by App.js's clamp loop to pick a
// valid value when the old one is no longer in the new allowlist.
export const FIELD_FALLBACKS = {
  output_format: ['png', 'jpeg', 'webp', 'svg'],
  quality:       ['auto', 'low', 'medium', 'high'],
  background:    ['auto', 'transparent', 'opaque'],
  resolution:    ['512', '1K', '2K', '4K'],
  duration:      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
}

// A single cap-aware <select> row. `fallback` is the per-field option
// list from FIELD_FALLBACKS; used when the model doesn't enumerate
// the field.
export function CapSelect({ name, label, fallback, view }) {
  const opts = optionsFor(view, name, fallback) || []
  const supported = !view || !view[name] || view[name].supported
  return html`
    <div class=${cx('field', { 'cap-unsupported': !supported })} data-cap-name=${name}>
      <label class="section-label" for=${name}>${label}</label>
      <select
        id=${name}
        name=${name}
        data-cap-name=${name}
        disabled=${!supported}
      >
        ${opts.map(v => html`<option key=${v} value=${v}>${v}</option>`)}
      </select>
    </div>
  `
}

// A single cap-aware <input type=number> row. Min/max come from the
// view; help text reflects the bounds. The `min` and `max` props
// are the static defaults to use when the model doesn't enumerate
// the field.
export function CapNumberInput({ name, label, help, min, max, value, view }) {
  const supported = !view || !view[name] || view[name].supported
  const r = rangeFor(view, name)
  const lo = (r && r.min !== null) ? r.min : (min || '')
  const hi = (r && r.max !== null) ? r.max : (max || '')
  const resolvedHelp = rangeHelp(view, name, help)
  return html`
    <div class=${cx('field', { 'cap-unsupported': !supported })} data-cap-name=${name}>
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
        disabled=${!supported}
      />
    </div>
  `
}

// A single cap-aware <input type=checkbox> row.
export function CapCheckbox({ name, label, view }) {
  const supported = !view || !view[name] || view[name].supported
  return html`
    <div class=${cx('field', { 'cap-unsupported': !supported })} data-cap-name=${name}>
      <label class="check" for=${name}>
        <input
          type="checkbox"
          id=${name}
          name=${name}
          data-cap-name=${name}
          disabled=${!supported}
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
