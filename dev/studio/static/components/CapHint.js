// components/CapHint.js — per-model quirk note shown above the
// Generate button.
//
// Reads state.capabilities.quirks; renders nothing when empty.
// The strings are plain text (no HTML); Preact's text rendering
// escapes them automatically, so we don't need a manual escaper.

import { h } from 'preact'
import htm from 'htm'
import { useStudio } from '../state.js'

const html = htm.bind(h)

export function CapHint() {
  const { state } = useStudio()
  const quirks = (state.capabilities && state.capabilities.quirks) || []
  if (quirks.length === 0) return null
  return html`
    <div id="cap-hint">
      <strong>Note for this model:</strong>
      <ul>
        ${quirks.map((q, i) => html`<li key=${i}>${q}</li>`)}
      </ul>
    </div>
  `
}
