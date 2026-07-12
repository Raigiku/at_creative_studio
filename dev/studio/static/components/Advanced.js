// components/Advanced.js — collapsed details for the seed field.
//
// The seed input is cap-aware: the input's min/max and disabled
// state come from the active model's capabilities (seed is a
// range param per FORM_FIELD_KIND).

import { h } from 'preact'
import htm from 'htm'
import { useStudio } from '../state.js'
import { deriveView, rangeFor } from '../capabilities.js'
import { cx } from '../helpers.js'

const html = htm.bind(h)

export function Advanced() {
  const { state } = useStudio()
  const view = deriveView(state.capabilities)
  const r = rangeFor(view, 'seed')
  const isSupported = !view || !view.seed || view.seed.supported
  const lo = (r && r.min !== null) ? r.min : ''
  const hi = (r && r.max !== null) ? r.max : ''
  return html`
    <details class="advanced">
      <summary>🔧 Advanced</summary>
      <div class="advanced-body">
        <div class="grid">
          <div class=${cx('field', { 'cap-unsupported': !isSupported })} data-cap-name="seed">
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
              disabled=${!isSupported}
            />
          </div>
        </div>
      </div>
    </details>
  `
}
