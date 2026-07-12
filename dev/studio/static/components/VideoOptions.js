// components/VideoOptions.js — video-only output options.
//
// First/last frame anchors (the Frames component), exact WxH
// size override, duration, resolution, and the generate-audio
// checkbox. All cap-aware fields use the shared CapSelect /
// CapNumberInput / CapCheckbox helpers from capFields.js. Fields
// the model doesn't support are dimmed and disabled.
//
// The "size" override text input is uncontrolled — its value
// lives in the DOM. We only need a local boolean to drive the
// .is-overridden class on the wrapper.

import { h } from 'preact'
import { useState } from 'preact/hooks'
import htm from 'htm'
import { useStudio } from '../state.js'
import { deriveView } from '../capabilities.js'
import { cx } from '../helpers.js'
import { SIZE_PATTERN } from '../fieldConfig.js'
import { CapSelect, CapNumberInput, CapCheckbox, FIELD_FALLBACKS } from './capFields.js'
import { Frames } from './Frames.js'

const html = htm.bind(h)

export function VideoOptions() {
  const { state } = useStudio()
  if (state.kind !== 'video') return null
  const view = deriveView(state.capabilities)
  return html`
    <div class="section">
      <span class="section-label">🎬 Video options</span>
      <div class="grid">
        <${Frames} />

        <${SizeField} />

        <${CapSelect}
          name="duration"
          label="⏱️ Duration"
          fallback=${FIELD_FALLBACKS.duration}
          view=${view}
        />
        <${CapSelect}
          name="resolution"
          label="📐 Resolution"
          fallback=${FIELD_FALLBACKS.resolution}
          view=${view}
        />
        <${CapCheckbox}
          name="generate_audio"
          label="🔊 Generate audio"
          view=${view}
        />
      </div>
    </div>
  `
}

// The "exact size" text input. Uncontrolled (the value lives in
// the DOM; FormData picks it up at submit). We only track a
// boolean to toggle the .is-overridden class so the user can see
// at a glance that Aspect + Resolution will be ignored.
function SizeField() {
  const [active, setActive] = useState(false)
  return html`
    <div class=${cx('field', 'field-full', { 'is-overridden': active })}>
      <label class="section-label" for="size_vid">
        📏 Exact size
        <span class="help">(W×H digits, e.g. 1280×720 — overrides Aspect + Resolution when set)</span>
      </label>
      <input
        type="text"
        class="input"
        id="size_vid"
        name="size"
        data-cap-name="size"
        inputmode="numeric"
        pattern=${SIZE_PATTERN.source}
        placeholder="leave empty to use Aspect + Resolution"
        onInput=${(e) => setActive(SIZE_PATTERN.test(e.currentTarget.value))}
      />
    </div>
  `
}
