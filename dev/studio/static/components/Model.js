// components/Model.js — model <select> with sorted options.
//
// Reads state.models[state.kind] and renders the dropdown. App.js
// owns the capabilities fetch that fires when modelID changes; this
// component just renders the <select> and emits the new id.

import { h } from 'preact'
import htm from 'htm'
import { useStudio } from '../state.js'

const html = htm.bind(h)

export function Model() {
  const { state, setState } = useStudio()
  const list = state.models[state.kind] || []

  return html`
    <div class="section">
      <label class="section-label" for="model">🧠 Model</label>
      <select
        id="model"
        name="model"
        required
        value=${state.modelID}
        onChange=${(e) => setState({ modelID: e.currentTarget.value })}
      >
        ${list.length === 0 && html`
          <option value="">(no models available — check API key) 🔑</option>
        `}
        ${list.map(m => html`
          <option key=${m.id} value=${m.id}>${m.name}</option>
        `)}
      </select>
    </div>
  `
}
