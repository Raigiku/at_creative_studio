// components/VideoOptions.js — video-only output options.
//
// First/last frame anchors (the Frames component), exact WxH
// size override, duration, resolution, and the generate-audio
// checkbox. All cap-aware fields use the shared CapSelect /
// CapNumberInput / CapCheckbox helpers from capFields.js. Fields
// the model doesn't support are dimmed and disabled.
//
// The "size" field is model-aware: most models have no entry
// for it (UI hides the row), and models that do (e.g. Seedance
// with its 25-value allowlist) render a <select> of the exact
// sizes the model accepts. A non-empty size is mutually
// exclusive with aspect_ratio + resolution — see applyConstraints
// in capabilities.js. We track a local boolean to drive the
// .is-overridden class so the user can see at a glance that
// Aspect + Resolution will be ignored.

import { h } from 'preact'
import { useState, useEffect, useRef } from 'preact/hooks'
import htm from 'htm'
import { useStudio } from '../state.js'
import { deriveView } from '../capabilities.js'
import { cx } from '../helpers.js'
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

        <${SizeField} view=${view} />

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

// The "size" field. Behavior depends on the model:
//   - Model has a capabilities.size block with values → <select>
//     with the model's exact allowlist (e.g. Seedance's 25
//     sizes). User picks one.
//   - Model has no size entry → field is hidden entirely. Most
//     video models only support aspect_ratio + resolution, so a
//     separate size override is non-sensical.
//   - (No more free-form text input: every current and future
//     model that has a size constraint advertises a finite list.)
function SizeField({ view }) {
  const supported = !view || !view.size || view.size.supported
  const hasValues = !!(view && view.size && view.size.detail
    && view.size.detail.type === 'enum'
    && Array.isArray(view.size.detail.values)
    && view.size.detail.values.length > 0)
  const opts = hasValues ? view.size.detail.values : []
  const ref = useRef(null)
  const [active, setActive] = useState(false)

  // Track whether the dropdown currently has a value so we can
  // toggle the .is-overridden class. We do it from the DOM on
  // every render because the <select> is uncontrolled (the value
  // lives in the DOM, not in component state).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setActive(!!el.value)
    const onChange = () => setActive(!!el.value)
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [opts.length])

  if (!supported || !hasValues) return null

  return html`
    <div class=${cx('field', 'field-full', { 'is-overridden': active })} data-cap-name="size">
      <label class="section-label" for="size_vid">
        📏 Exact size
        <span class="help">(overrides Aspect + Resolution when set)</span>
      </label>
      <select
        ref=${ref}
        id="size_vid"
        name="size"
        data-cap-name="size"
      >
        <option value="">— use Aspect + Resolution —</option>
        ${opts.map(v => html`<option key=${v} value=${v}>${v}</option>`)}
      </select>
    </div>
  `
}
