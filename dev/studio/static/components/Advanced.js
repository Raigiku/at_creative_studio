// components/Advanced.js — collapsed details for the seed field.
//
// The seed input is cap-aware: the input's min/max come from the
// active model's capabilities (seed is a range param per
// FORM_FIELD_KIND). Hidden entirely when the model doesn't
// support seed.

import { h } from 'preact'
import htm from 'htm'
import { useStudio } from '../state.js'
import { deriveView, rangeFor } from '../capabilities.js'

const html = htm.bind(h)

export function Advanced() {
  const { state } = useStudio()
  const view = deriveView(state.capabilities)
  const isSupported = !view || !view.seed || view.seed.supported
  if (!isSupported) return null
  const r = rangeFor(view, 'seed')
  const lo = (r && r.min !== null) ? r.min : ''
  const hi = (r && r.max !== null) ? r.max : ''
  return html`
    <details class="advanced">
      <summary>🔧 Advanced</summary>
      <div class="advanced-body">
        <div class="grid">
          <div class="field" data-cap-name="seed">
            <label class="section-label" for="seed">
              🌱 Seed <span class="help">(empty = random)</span>
            </label>
            <input
              type="number"
              class="input"
              id="seed"
              name="seed"
              data-cap-name="seed"
              min=${lo}
              max=${hi}
              step="1"
              placeholder="Random"
            />
          </div>
        </div>
      </div>
    </details>
  `
}
