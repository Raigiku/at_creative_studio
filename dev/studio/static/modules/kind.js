// modules/kind.js
//
// image/video output toggle + the [data-show] visibility logic that
// hides/shows sections based on the current kind, plus the
// resolution-pair swap and the size-override UI.
//
// Public API:
//   initKind()        — wire the type radio and size input listeners.
//   setKind(v)        — user-facing setter; updates state + re-renders.
//   currentType()     — read state.kind (kept for back-compat with
//                        other modules that import this name).
//   getSizePattern()  — the WxH regex (used by other modules).
//   refreshKindVisibility, refreshResolutionSelect, refreshSizeOverride —
//                        kept for back-compat; no-op shims that delegate
//                        to the render function.

import { getForm, getSizeInput, getAspectHidden, getAspectMore } from './dom.js'
import { state, subscribe, setState } from './state.js'

// WxH pattern for the "Exact size" field. Mirrors the server-side
// `sizePattern` in dev/studio/params.go and the `pattern=` attribute
// on the size input in index.html.
const sizePattern = /^[1-9][0-9]{1,4}x[1-9][0-9]{1,4}$/

export function getSizePattern() {
  return sizePattern
}

export function currentType() {
  return state.kind
}

// Cached wrappers for the size-override path. Resolved on first use.
let _aspectSection = null
let _resolutionField = null
let _resolutionSel = null

function sectionOf(el) {
  const form = getForm()
  while (el && el !== form) {
    if (el.classList && el.classList.contains('section')) return el
    el = el.parentElement
  }
  return null
}

function getAspectSection() {
  if (_aspectSection === null) {
    _aspectSection = sectionOf(document.getElementById('aspect_ratio'))
  }
  return _aspectSection
}
function getResolutionField() {
  if (_resolutionField === null) {
    _resolutionField = getForm().querySelector('select[name=resolution][data-res-kind="video"]')?.closest('.field')
  }
  return _resolutionField
}
function getResolutionSel() {
  if (_resolutionSel === null) {
    _resolutionSel = getForm().querySelector('select[name=resolution][data-res-kind="video"]')
  }
  return _resolutionSel
}

// renderKind — pure read of state.kind + state.sizeOverride.
function renderKind() {
  const form = getForm()
  const kind = state.kind
  const aspectHidden = getAspectHidden()
  const aspectMore = getAspectMore()
  const aspectSection = getAspectSection()
  const resolutionField = getResolutionField()
  const resolutionSel = getResolutionSel()

  // Show/hide [data-show] sections and disable hidden fields.
  for (const el of form.querySelectorAll('[data-show]')) {
    el.style.display = el.dataset.show === kind ? '' : 'none'
  }
  for (const el of form.querySelectorAll('[data-show]')) {
    const hidden = el.dataset.show !== kind
    for (const inner of el.querySelectorAll('input, select, textarea')) {
      inner.disabled = hidden
    }
  }

  // Resolution pair swap.
  for (const sel of form.querySelectorAll('select[name=resolution]')) {
    sel.disabled = sel.dataset.resKind !== kind
  }

  // Size override: when in video mode AND the user typed a valid
  // WxH, dim aspect + resolution and disable the underlying inputs.
  if (kind !== 'video') {
    if (aspectSection) aspectSection.classList.remove('is-overridden')
    if (resolutionField) resolutionField.classList.remove('is-overridden')
    if (aspectHidden) aspectHidden.disabled = false
    if (resolutionSel) resolutionSel.disabled = resolutionSel.dataset.resKind !== kind
  } else {
    const active = state.sizeOverride && sizePattern.test(state.sizeOverride)
    if (aspectSection) aspectSection.classList.toggle('is-overridden', active)
    if (resolutionField) resolutionField.classList.toggle('is-overridden', active)
    if (aspectHidden) aspectHidden.disabled = active
    if (resolutionSel) resolutionSel.disabled = active || resolutionSel.dataset.resKind !== kind
  }

  // Suppress the "More…" dropdown if it adds nothing beyond the pills.
  // (Aspect.js does the same check; harmless to do twice — both run
  // on the same render and write the same value.)
  void aspectMore
}

export function initKind() {
  const sizeInput = getSizeInput()
  if (sizeInput) {
    // Initialize state.sizeOverride from the input.
    state.sizeOverride = sizeInput.value || ''
    sizeInput.addEventListener('input', () => {
      setState({ sizeOverride: sizeInput.value || '' })
    })
  }
  const form = getForm()
  for (const radio of form.querySelectorAll('input[name=type]')) {
    radio.addEventListener('change', () => {
      setKind(radio.value)
    })
  }
  subscribe(renderKind)
}

export function setKind(v) {
  if (v !== 'image' && v !== 'video') return
  // Sync the radio (the source of truth for the form), then update state.
  const form = getForm()
  const radio = form.querySelector(`input[name=type][value="${v}"]`)
  if (radio) radio.checked = true
  setState({ kind: v })
}

// Back-compat shims. The new architecture re-renders everything in
// render(), so explicit calls are redundant. We keep the function
// signatures so other modules don't need to change.
export function refreshKindVisibility() { renderKind() }
export function refreshResolutionSelect() { renderKind() }
export function refreshSizeOverride() { renderKind() }
