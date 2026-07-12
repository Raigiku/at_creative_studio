// components/Submit.js — the Generate button.
//
// submit.js owns the button's disabled state directly on the DOM
// (toggles it true at the start of a request, false in the
// finally block). This component just renders the button.

import { h } from 'preact'
import htm from 'htm'

const html = htm.bind(h)

export function GenerateButton() {
  return html`
    <button
      id="generate-btn"
      class="generate-btn"
      type="submit"
    >✨ Generate</button>
  `
}
