// components/Status.js — the status bar + the preview area below
// the form. submit.js / status.js write to #status + #preview
// directly; this component just renders the empty containers.

import { h, Fragment } from 'preact'
import htm from 'htm'

const html = htm.bind(h)

export function Status() {
  return html`
    <${Fragment}>
      <div id="status" class="status status--idle">Ready</div>
      <div id="preview"></div>
    <//>
  `
}
