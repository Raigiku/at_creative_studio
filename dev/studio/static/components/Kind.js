// components/Kind.js — image/video output toggle.
//
// A two-option segmented control. Setting the value updates
// state.kind (which triggers a re-render of the rest of the form).

import { h } from 'preact'
import htm from 'htm'
import { useStudio } from '../state.js'

const html = htm.bind(h)

export function Kind() {
  const { state, setState } = useStudio()
  const kind = state.kind
  return html`
    <div class="section">
      <span class="section-label">🎛️ Output</span>
      <div class="segmented segmented-2" id="type-segmented">
        <input
          type="radio"
          name="type"
          id="type-image"
          value="image"
          checked=${kind === 'image'}
          onChange=${() => setState({ kind: 'image' })}
        />
        <label for="type-image">🖼️ Image</label>
        <input
          type="radio"
          name="type"
          id="type-video"
          value="video"
          checked=${kind === 'video'}
          onChange=${() => setState({ kind: 'video' })}
        />
        <label for="type-video">🎬 Video</label>
      </div>
    </div>
  `
}
