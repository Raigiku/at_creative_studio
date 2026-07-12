// modules/kind.js
//
// The "image" vs "video" output toggle. Owns:
//   - currentType()                     — read the active radio
//   - refreshKindVisibility()           — show/hide [data-show] sections
//   - refreshResolutionSelect()         — enable the right resolution select
//   - refreshSizeOverride()             — exact-size field dims aspect+res
//   - getSizePattern()                  — the WxH regex
//   - the size input's 'input' listener (wired by initKind)
//
// The output type radio's 'change' listener is also installed here —
// it calls onKindChanged(opts) so the orchestrator can re-run
// refreshAll() and re-render the reference previews with the new
// role badges.
//
// Pattern: kind.js owns a tiny bit of state (the cached aspect section
// and resolution field wrappers) and exposes the functions that
// other modules need. The "current kind" is read directly from the
// form (form.type.value), so we don't keep a separate copy.

import {
  getForm,
  getSizeInput,
  getAspectHidden,
} from './dom.js'

// WxH pattern for the "Exact size" field. Mirrors the server-side
// `sizePattern` in dev/studio/params.go and the `pattern=` attribute
// on the size input in index.html, so client-side validity, server-side
// validation, and the live override behavior all agree.
const sizePattern = /^[1-9][0-9]{1,4}x[1-9][0-9]{1,4}$/

export function getSizePattern() {
  return sizePattern
}

export function currentType() {
  return getForm().type.value // "image" | "video"
}

// Cached wrappers used by refreshSizeOverride. Resolved on first use
// (so we don't break if initKind runs before the form is rendered).
let _aspectSection = null
let _resolutionField = null
let _resolutionSel = null
let _onKindChanged = () => {}

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

export function initKind({ onKindChanged } = {}) {
  _onKindChanged = onKindChanged || _onKindChanged
  const sizeInput = getSizeInput()
  if (sizeInput) sizeInput.addEventListener('input', refreshSizeOverride)
  const form = getForm()
  for (const radio of form.querySelectorAll('input[name=type]')) {
    radio.addEventListener('change', () => {
      _onKindChanged()
    })
  }
}

// ---- show/hide image vs video fields ----
export function refreshKindVisibility() {
  const form = getForm()
  const kind = currentType() // "image" | "video"
  for (const el of form.querySelectorAll('[data-show]')) {
    el.style.display = el.dataset.show === kind ? '' : 'none'
  }
  // Disable hidden fields so they don't ride along in the form submission.
  for (const el of form.querySelectorAll('[data-show]')) {
    const hidden = el.dataset.show !== kind
    for (const inner of el.querySelectorAll('input, select, textarea')) {
      inner.disabled = hidden
    }
  }
}

// Resolution has two selects (image vs video) with the same name="resolution".
// We swap which one is enabled based on kind. The disabled one's value is
// already blank ("") by default, so it would override the active one if not
// for `disabled` excluding it from FormData.
export function refreshResolutionSelect() {
  const kind = currentType()
  for (const sel of getForm().querySelectorAll('select[name=resolution]')) {
    sel.disabled = sel.dataset.resKind !== kind
  }
}

// ---- exact-size override (video only) ----
//
// The video options section has an `Exact size` field (input
// name="size", placeholder says "leave empty to use Aspect +
// Resolution"). When the user types a valid WxH string, that value
// overrides `aspect_ratio` and `resolution`: we disable those two
// fields so only `size` is sent on the wire, and we add the
// `is-overridden` class to the Aspect ratio section and to the
// resolution field's row so the user sees that those values won't
// take effect.
//
// When the field is empty, we restore everything to normal.
export function refreshSizeOverride() {
  // Only meaningful in video mode — in image mode the size field is
  // hidden anyway (data-show="video" on its wrapper).
  const sizeInput = getSizeInput()
  const aspectHidden = getAspectHidden()
  const aspectSection = getAspectSection()
  const resolutionField = getResolutionField()
  const resolutionSel = getResolutionSel()
  const kind = currentType()
  if (kind !== 'video') {
    if (aspectSection) aspectSection.classList.remove('is-overridden')
    if (resolutionField) resolutionField.classList.remove('is-overridden')
    if (aspectHidden) aspectHidden.disabled = false
    if (resolutionSel) resolutionSel.disabled = resolutionSel.dataset.resKind !== kind
    return
  }
  const v = sizeInput ? sizeInput.value.trim() : ''
  const active = v !== '' && sizePattern.test(v)
  // Visual feedback: dim the aspect / resolution rows so the user can
  // see at a glance which fields are being overridden.
  if (aspectSection) aspectSection.classList.toggle('is-overridden', active)
  if (resolutionField) resolutionField.classList.toggle('is-overridden', active)
  // Belt-and-suspenders: also disable the underlying form controls so
  // the FormData snapshot is guaranteed to omit them. (The browser
  // excludes disabled inputs from submission, so this is what makes
  // the override actually take effect on the wire.)
  if (aspectHidden) aspectHidden.disabled = active
  if (resolutionSel) resolutionSel.disabled = active || resolutionSel.dataset.resKind !== kind
}
