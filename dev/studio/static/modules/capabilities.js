// modules/capabilities.js
//
// The model list, the per-model capabilities fetch+cache, the
// field-apply logic (dim unsupported, apply enum/range, update help
// text), and the model <select> repopulator.
//
// State-driven: the only mutators are setModel() (called from the
// model <select>'s change handler) and the bootstrap that sets
// state.models. The apply logic runs as a subscriber that reads
// state.capabilities and writes the DOM.
//
// Public API:
//   initCapabilities()         — wire the model <select> listener.
//   bootstrapCapabilities()    — fetch /api/models and apply the
//                                initial model's capabilities. Returns
//                                a Promise so the orchestrator can
//                                await it.
//   setModel(id)               — user-facing setter (also called by
//                                the model <select> change handler).
//   applyCapabilitiesFromData(cap) — back-compat alias for the
//                                orchestrator's bootstrap path.
//
// State touched:
//   state.models           — { image: [...], video: [...] }
//   state.modelID          — currently selected model id
//   state.capabilities     — { supported_params, param_details, quirks }
//   state.refMax           — derived from input_references.max

import { getForm, getCapHint } from './dom.js'
import { sortOptions } from './sort.js'
import { state, subscribe, setState } from './state.js'
import { applyAspectEnum } from './aspect.js'
import { getMAX_REFS } from './references.js'

// ---------------------------------------------------------------------------
// FORM_NAME_TO_CAP_NAME / FORM_FIELD_KIND — the per-field config tables.
// Moved here from the old capabilities module; unchanged in behavior.
// ---------------------------------------------------------------------------
const FORM_NAME_TO_CAP_NAME = {
  aspect_ratio:        'aspect_ratio',
  background:          'background',
  output_format:       'output_format',
  quality:             'quality',
  resolution:          'resolution',
  n:                   'n',
  output_compression:  'output_compression',
  seed:                'seed',
  duration:            'duration',
  size:                'size',
  // Video-specific fields.
  frame_first:         'frame_first',
  frame_last:          'frame_last',
  generate_audio:      'generate_audio',
}

const FORM_FIELD_KIND = {
  aspect_ratio:        { kind: 'aspect_enum', selector: 'aspect_ratio' },
  resolution:          { kind: 'enum_or_range', selector: 'resolution' },
  output_format:       { kind: 'enum',  selector: 'output_format' },
  quality:             { kind: 'enum',  selector: 'quality' },
  background:          { kind: 'enum',  selector: 'background' },
  n:                   { kind: 'range', selector: 'n',         helpTemplate: '({{min}}–{{max}})' },
  output_compression:  { kind: 'range', selector: 'output_compression' },
  duration:            { kind: 'enum', selector: 'duration', helpTemplate: '(seconds, {{min}}–{{max}})' },
  seed:                { kind: 'range', selector: 'seed' },
  frame_first:         { kind: 'none',  selector: 'frame_first' },
  frame_last:          { kind: 'none',  selector: 'frame_last' },
  generate_audio:      { kind: 'none',  selector: 'generate_audio' },
}

// ---------------------------------------------------------------------------
// Field-apply helpers. These are the "what does the form look like for
// this model" functions. They run inside render(), not as subscribers,
// because they need a snapshot of state.capabilities at the moment
// state was changed — and the subscriber system always reads the
// current state, which is what we want.
// ---------------------------------------------------------------------------

function fieldWrapperFor(name) {
  const form = getForm()
  const sel = form.querySelector(`[name="${name}"]`)
  if (!sel) return null
  let wrap = sel.closest('.field') || sel.closest('.section')
  if (wrap && !wrap.dataset.capName) wrap.dataset.capName = name
  return wrap
}

function setFieldUnsupported(name, unsupported) {
  const wrap = fieldWrapperFor(name)
  if (!wrap) return
  wrap.classList.toggle('cap-unsupported', unsupported)
  if (unsupported) {
    for (const inner of wrap.querySelectorAll('input, select, textarea')) {
      inner.dataset.capDisabled = '1'
      inner.disabled = true
    }
  } else {
    for (const inner of wrap.querySelectorAll('[data-cap-disabled]')) {
      delete inner.dataset.capDisabled
    }
  }
}

function refreshCapHint(quirks) {
  const capHintEl = getCapHint()
  if (!capHintEl) return
  if (!quirks || quirks.length === 0) {
    capHintEl.hidden = true
    capHintEl.textContent = ''
    return
  }
  capHintEl.hidden = false
  capHintEl.innerHTML = '<strong>Note for this model:</strong><ul>' +
    quirks.map(q => `<li>${escapeHTML(q)}</li>`).join('') +
    '</ul>'
}

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function findHelpSpan(inp) {
  const wrap = inp.closest('.field') || inp.closest('.section')
  if (!wrap) return null
  return wrap.querySelector('.section-label .help')
}

function applyEnumToSelects(name, detail, helpTemplate) {
  const form = getForm()
  const selects = form.querySelectorAll(`select[name="${name}"]`)
  if (selects.length === 0) return
  for (const sel of selects) {
    const prev = sel.value
    sel.innerHTML = ''
    let values
    if (detail && detail.type === 'enum' && Array.isArray(detail.values) && detail.values.length > 0) {
      values = sortOptions(detail.values)
    } else {
      values = []
    }
    for (const v of values) {
      const opt = document.createElement('option')
      opt.value = v
      opt.textContent = v
      sel.appendChild(opt)
    }
    if (values.length === 0) {
      sel.value = ''
      sel.dataset.capAutoAdjusted = ''
    } else if (values.includes(prev)) {
      sel.value = prev
      delete sel.dataset.capAutoAdjusted
    } else {
      sel.value = values[0]
      sel.dataset.capAutoAdjusted = '1'
    }
    if (helpTemplate) {
      const helpSpan = findHelpSpan(sel)
      if (helpSpan) {
        if (helpSpan.dataset.origHelp === undefined) {
          helpSpan.dataset.origHelp = helpSpan.textContent
        }
        const nums = values.map(v => parseFloat(v)).filter(n => Number.isFinite(n))
        if (nums.length > 0) {
          const lo = Math.min(...nums)
          const hi = Math.max(...nums)
          if (lo === hi) {
            helpSpan.textContent = helpTemplate
              .replace('{{min}}', String(lo))
              .replace('{{max}}', String(hi))
              .replace('–', '')
          } else {
            helpSpan.textContent = helpTemplate
              .replace('{{min}}', String(lo))
              .replace('{{max}}', String(hi))
          }
        } else {
          helpSpan.textContent = helpSpan.dataset.origHelp
        }
      }
    }
  }
}

function applyRangeToInput(name, detail, helpTemplate) {
  const form = getForm()
  const inputs = form.querySelectorAll(`input[name="${name}"]`)
  if (inputs.length === 0) return
  for (const inp of inputs) {
    if (inp.dataset.origMin === undefined) {
      inp.dataset.origMin = inp.getAttribute('min') || ''
      inp.dataset.origMax = inp.getAttribute('max') || ''
    }
    let minStr, maxStr
    if (detail && detail.type === 'range') {
      if (detail.min !== undefined && detail.min !== null) minStr = String(detail.min)
      if (detail.max !== undefined && detail.max !== null) maxStr = String(detail.max)
    } else {
      minStr = inp.dataset.origMin
      maxStr = inp.dataset.origMax
    }
    if (minStr !== '') inp.setAttribute('min', minStr); else inp.removeAttribute('min')
    if (maxStr !== '') inp.setAttribute('max', maxStr); else inp.removeAttribute('max')
    const v = parseFloat(inp.value)
    if (Number.isFinite(v)) {
      const lo = parseFloat(minStr)
      const hi = parseFloat(maxStr)
      let clamped = v
      if (Number.isFinite(lo) && clamped < lo) clamped = lo
      if (Number.isFinite(hi) && clamped > hi) clamped = hi
      if (clamped !== v) {
        inp.value = String(clamped)
        inp.dataset.capAutoAdjusted = '1'
      } else {
        delete inp.dataset.capAutoAdjusted
      }
    } else {
      delete inp.dataset.capAutoAdjusted
    }
    if (helpTemplate) {
      const helpSpan = findHelpSpan(inp)
      if (helpSpan) {
        if (helpSpan.dataset.origHelp === undefined) {
          helpSpan.dataset.origHelp = helpSpan.textContent
        }
        const lo = parseFloat(minStr)
        const hi = parseFloat(maxStr)
        if (Number.isFinite(lo) && Number.isFinite(hi)) {
          if (lo === hi) {
            helpSpan.textContent = `(${lo})`
          } else {
            helpSpan.textContent = helpTemplate
              .replace('{{min}}', String(lo))
              .replace('{{max}}', String(hi))
          }
        } else {
          helpSpan.textContent = helpSpan.dataset.origHelp
        }
      }
    }
  }
}

function applyParamDetails(paramDetails) {
  for (const [formName, capName] of Object.entries(FORM_NAME_TO_CAP_NAME)) {
    const fc = FORM_FIELD_KIND[formName]
    if (!fc) continue
    const detail = paramDetails ? paramDetails[capName] : null
    switch (fc.kind) {
      case 'enum':
        applyEnumToSelects(fc.selector, detail, fc.helpTemplate)
        break
      case 'range':
        applyRangeToInput(fc.selector, detail, fc.helpTemplate)
        break
      case 'enum_or_range':
        if (detail && detail.type === 'range') {
          applyRangeToInput(fc.selector, detail, fc.helpTemplate)
        } else {
          applyEnumToSelects(fc.selector, detail, fc.helpTemplate)
        }
        break
      case 'aspect_enum':
        applyAspectEnum(detail)
        break
    }
  }
}

// ---------------------------------------------------------------------------
// renderCapabilities — the subscriber that applies state.capabilities
// to the DOM. Called on every state change (so kind switches, model
// switches, and any future state additions all re-apply).
// ---------------------------------------------------------------------------
function renderCapabilities() {
  // Reset all fields to "supported", then re-disable the ones not
  // in the current capabilities. Resetting first means switching
  // from a restrictive to a permissive model re-enables everything.
  for (const formName of Object.keys(FORM_NAME_TO_CAP_NAME)) {
    setFieldUnsupported(formName, false)
  }
  const cap = state.capabilities
  if (!cap) {
    // No model selected: clear the model-driven UI. Per-model
    // allowlists reset to HTML defaults. The ref cap falls back
    // to MAX_REFS.
    refreshCapHint(null)
    applyParamDetails(null)
    state.refMax = getMAX_REFS()
    return
  }
  const supported = new Set(cap.supported_params || [])
  for (const [formName, capName] of Object.entries(FORM_NAME_TO_CAP_NAME)) {
    if (supported.size > 0 && !supported.has(capName)) {
      setFieldUnsupported(formName, true)
    }
  }
  const details = cap.param_details || null
  applyParamDetails(details)
  // Update the reference-image cap from input_references.max. The
  // ref module's render will pick this up on its next pass.
  const ir = details && details.input_references
  if (ir && ir.type === 'range' && typeof ir.max === 'number' && ir.max > 0) {
    state.refMax = Math.floor(ir.max)
  } else {
    state.refMax = getMAX_REFS()
  }
  refreshCapHint(cap.quirks || [])
}

// renderModelOptions — repopulate the model <select> based on
// state.kind + state.models. Subscribed so kind switches and model
// list loads both re-render.
function renderModelOptions() {
  const form = getForm()
  const type = state.kind
  const select = form.model
  const list = state.models[type] || []
  select.innerHTML = ''
  if (list.length === 0) {
    const opt = document.createElement('option')
    opt.textContent = '(no models available — check API key) 🔑'
    select.appendChild(opt)
    return
  }
  const sorted = list.slice().sort((a, b) => {
    const an = (a.name || a.id || '').toLocaleLowerCase()
    const bn = (b.name || b.id || '').toLocaleLowerCase()
    if (an < bn) return -1
    if (an > bn) return 1
    return 0
  })
  for (const m of sorted) {
    const opt = document.createElement('option')
    opt.value = m.id
    opt.textContent = m.name
    select.appendChild(opt)
  }
  // If the previously selected model isn't in the new list, clear it.
  if (!list.find(m => m.id === state.modelID)) {
    state.modelID = ''
  }
  select.value = state.modelID
}

// ---------------------------------------------------------------------------
// Per-model fetch + cache. Identical behavior to the old
// applyCapabilitiesForModel, but on completion it just sets
// state.capabilities and lets render() pick it up.
// ---------------------------------------------------------------------------
const modelCapabilitiesCache = new Map()
let capabilitiesInflight = null

async function fetchCapabilitiesForModel(modelID) {
  if (!modelID) return null
  if (modelCapabilitiesCache.has(modelID)) {
    return modelCapabilitiesCache.get(modelID)
  }
  if (capabilitiesInflight) {
    try { await capabilitiesInflight } catch (_) { /* ignore */ }
    if (modelCapabilitiesCache.has(modelID)) {
      return modelCapabilitiesCache.get(modelID)
    }
  }
  capabilitiesInflight = (async () => {
    try {
      const r = await fetch(`/api/models/${encodeURIComponent(modelID)}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return await r.json()
    } finally {
      capabilitiesInflight = null
    }
  })()
  try {
    const cap = await capabilitiesInflight
    modelCapabilitiesCache.set(modelID, cap)
    return cap
  } catch (err) {
    console.warn('capabilities fetch failed:', err)
    return null
  }
}

// setModel — the user-facing setter. Updates state.modelID,
// fetches the per-model caps, applies them. The intermediate
// "loading" state isn't visible to the user; the next render()
// will reflect the new model.
export async function setModel(modelID) {
  const form = getForm()
  form.model.value = modelID
  setState({ modelID })
  if (!modelID) {
    setState({ capabilities: null })
    return
  }
  const cap = await fetchCapabilitiesForModel(modelID)
  setState({ capabilities: cap })
}

// applyCapabilitiesFromData — back-compat with the old orchestrator's
// bootstrap path. Just sets state.capabilities.
export function applyCapabilitiesFromData(cap) {
  setState({ capabilities: cap })
}

export function initCapabilities() {
  const form = getForm()
  form.model.addEventListener('change', () => {
    setModel(form.model.value)
  })
  subscribe(renderCapabilities)
  subscribe(renderModelOptions)
}

// bootstrapCapabilities — fetch /api/models, populate the dropdown,
// and apply the initial model's capabilities. Returns a Promise so
// the orchestrator can await it.
export async function bootstrapCapabilities() {
  const m = await fetch('/api/models').then(r => r.json())
  state.models = m
  // Pick the first model for the current kind.
  const list = m[state.kind] || []
  const initialID = list[0] ? list[0].id : ''
  state.modelID = initialID
  // The subscribers will re-render the model dropdown on the next
  // setState, so we just trigger one.
  setState({ models: m, modelID: initialID })
  if (initialID) {
    const cap = await fetchCapabilitiesForModel(initialID)
    setState({ capabilities: cap })
  } else {
    setState({ capabilities: null })
  }
}
