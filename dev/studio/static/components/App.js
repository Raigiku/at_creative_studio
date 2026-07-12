// components/App.js — the top-level form. Composes every other
// component and owns:
//   - the single source of truth for shared form state (useState)
//   - the bootstrap: fetch /api/models on mount, then fetch the
//     initial model's capabilities
//   - the per-kind default model + aspect ratio reset when kind
//     changes
//   - the capabilities fetch when modelID changes (single owner)
//   - the clamp-on-model-change: walk the form and replace any
//     value that's no longer valid for the new model

import { h, Fragment } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import htm from 'htm'
import { StudioContext, STUDIO_INITIAL_STATE } from '../state.js'
import { fetchModels, fetchCapabilities } from '../api.js'
import {
  CAP_AWARE_ATTR,
  DEFAULT_ASPECT,
  FORM_FIELD_KIND,
  FORM_NAME_TO_CAP_NAME,
} from '../fieldConfig.js'
import { setStatus } from '../status.js'
import { submitGenerate } from '../submit.js'
import { sortModels } from '../sort.js'
import { deriveView } from '../capabilities.js'
import { FIELD_FALLBACKS } from './capFields.js'

import { Kind } from './Kind.js'
import { Model } from './Model.js'
import { Aspect } from './Aspect.js'
import { References } from './References.js'
import { ImageOptions } from './ImageOptions.js'
import { VideoOptions } from './VideoOptions.js'
import { CapHint } from './CapHint.js'
import { Advanced } from './Advanced.js'
import { GenerateButton } from './Submit.js'
import { Status } from './Status.js'

const html = htm.bind(h)

// First model id for a given kind, or '' when the list is empty.
function firstModelID(models, kind) {
  const list = models[kind] || []
  return list.length > 0 ? list[0].id : ''
}

export function App() {
  const [state, setState] = useState(STUDIO_INITIAL_STATE)
  const formRef = useRef(null)
  // Shallow-merge patch. Every setState in the app uses this
  // pattern, so the one-line wrapper saves the spread noise at
  // each call site.
  const set = (p) => setState(prev => ({ ...prev, ...p }))

  // ---- 1. Bootstrap on mount: fetch /api/models and the initial
  // model's capabilities.
  useEffect(() => {
    let cancelled = false
    fetchModels()
      .then(raw => {
        if (cancelled) return
        const models = {
          image: sortModels(raw.image || []),
          video: sortModels(raw.video || []),
        }
        const initialID = firstModelID(models, state.kind)
        set({
          models,
          modelID: initialID,
          aspectActive: DEFAULT_ASPECT[state.kind] || '1:1',
        })
      })
      .catch(err => {
        if (cancelled) return
        setStatus('error', `Failed to load models: ${err.message || err}`)
      })
    return () => { cancelled = true }
  }, [])

  // ---- 2. When the kind changes, pick a new default model from
  // the matching list and reset the aspect to the per-kind default.
  useEffect(() => {
    set({
      modelID: firstModelID(state.models, state.kind),
      aspectActive: DEFAULT_ASPECT[state.kind] || '1:1',
    })
  }, [state.kind])

  // ---- 3. When modelID changes, fetch the new model's
  // capabilities. App is the single owner of this fetch — Model.js
  // just renders the <select>. We clear capabilities on every
  // modelID change so the clamp-on-model-change effect below
  // can't run against the previous model's capabilities.
  useEffect(() => {
    if (!state.modelID) {
      set({ capabilities: null })
      return
    }
    set({ capabilities: null })
    let cancelled = false
    fetchCapabilities(state.modelID)
      .then(cap => { if (!cancelled) set({ capabilities: cap }) })
      .catch(err => {
        if (cancelled) return
        console.warn('capabilities fetch failed', err)
        set({ capabilities: null })
      })
    return () => { cancelled = true }
  }, [state.modelID])

  // ---- 3b. After the model + its capabilities are loaded, walk
  // the form and replace any value that's no longer valid for the
  // new model. The form is the source of truth for the final
  // submit, so we correct the DOM directly. File inputs and
  // state-only fields (refFiles, frameFirstFile, frameLastFile)
  // are owned by their respective components, which clear them
  // locally in their own useEffects.
  useEffect(() => {
    if (!state.modelID || !state.capabilities) return
    const form = formRef.current
    if (!form) return
    const view = deriveView(state.capabilities)
    for (const formName of Object.keys(FORM_NAME_TO_CAP_NAME)) {
      const fieldKind = FORM_FIELD_KIND[formName]
      if (!fieldKind) continue
      // Only clamp the kinds that have meaningful values.
      if (
        fieldKind.kind !== 'enum'
        && fieldKind.kind !== 'enum_or_range'
        && fieldKind.kind !== 'range'
      ) continue

      const elements = form.querySelectorAll(`[${CAP_AWARE_ATTR}="${formName}"]`)
      for (const el of elements) {
        clampElement(el, formName, fieldKind, view)
      }
    }
  }, [state.modelID, state.capabilities])

  // ---- 4. Wire the form's submit handler. We use a ref on the
  // <form> rather than document.getElementById, so the form ref
  // follows the Preact tree. submit.js owns the status bar and
  // the button's disabled state.
  useEffect(() => {
    const form = formRef.current
    if (!form) return
    const onSubmit = (e) => {
      e.preventDefault()
      submitGenerate({ isRetry: false })
    }
    form.addEventListener('submit', onSubmit)
    return () => form.removeEventListener('submit', onSubmit)
  }, [])

  return html`
    <${Fragment}>
      <${StudioContext.Provider} value=${{ state, setState: set }}>
        <form ref=${formRef} id="gen-form">
          <${Kind} />
          <div class="section">
            <label class="section-label" for="prompt">💭 Prompt</label>
            <textarea
              id="prompt"
              name="prompt"
              placeholder="A knight walks slowly into a dark cave, volumetric fog, cinematic lighting, 4k"
              required
            ></textarea>
          </div>
          <${References} />
          <${Model} />
          <${Aspect} />
          <${ImageOptions} />
          <${VideoOptions} />
          <${Advanced} />
          <${CapHint} />
          <${GenerateButton} />
        </form>
        <${Status} />
      <//>
    <//>
  `
}

// Clamp one form element to the new model's allowlist. Pure DOM
// mutation. Behavior per field kind:
//   - enum / enum_or_range with enum detail: <select> — if the
//     current value isn't in the new allowlist, set it to the
//     first valid option (or '' when the field is unsupported).
//   - range / enum_or_range with range detail: <input type=number>
//     — clamp the value to [min, max]. If the field is
//     unsupported, clear it.
function clampElement(el, formName, fieldKind, view) {
  const f = view && view[formName]
  const supported = f && f.supported
  const fallback = FIELD_FALLBACKS[formName]

  // <input type=number>: clamp numeric value.
  if (
    (fieldKind.kind === 'range'
     || (fieldKind.kind === 'enum_or_range' && f && f.detail && f.detail.type === 'range'))
    && el.type === 'number'
  ) {
    if (!supported) {
      // Field unsupported: clear the value so it doesn't ride
      // along to the server. (The field is also disabled by the
      // renderer, but DOM disabling doesn't omit the value from
      // FormData; clearing does.)
      if (el.value !== '') el.value = ''
      return
    }
    if (!f || !f.detail || f.detail.type !== 'range') return
    const lo = f.detail.min
    const hi = f.detail.max
    const cur = el.value === '' ? null : Number(el.value)
    if (cur === null || !Number.isFinite(cur)) return
    const minV = lo !== undefined && lo !== null ? Number(lo) : -Infinity
    const maxV = hi !== undefined && hi !== null ? Number(hi) : Infinity
    const clamped = Math.min(maxV, Math.max(minV, cur))
    if (clamped !== cur) el.value = String(clamped)
    return
  }

  // enum / enum_or_range with enum detail: <select>.
  if (el.tagName !== 'SELECT') return
  // Walk the model-reported enum values directly (or the static
  // fallback). We avoid going through optionsFor() to keep the
  // dependency surface small — this is the only call site.
  let opts
  if (f && f.supported && f.detail && f.detail.type === 'enum' && Array.isArray(f.detail.values) && f.detail.values.length > 0) {
    opts = f.detail.values
  } else if (f && !f.supported) {
    opts = []
  } else {
    opts = fallback || []
  }
  if (opts.length === 0) {
    if (el.value !== '') el.value = ''
    return
  }
  if (!el.value || !opts.includes(el.value)) {
    el.value = opts[0]
  }
}
