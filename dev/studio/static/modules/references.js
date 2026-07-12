// modules/references.js
//
// Reference image picker: the multi-file <input> plus the preview
// grid that shows each pick with a "First/Last frame" role badge
// (video mode only), an index pill, a remove button, and a
// selectable filename strip.
//
// Public API:
//
//   initReferences({ getCurrentRefMax, onChange }) — wire up listeners.
//   refreshRefHint()        — update the per-model "you can pick N"
//                              hint and the over-cap error in the
//                              status bar.
//   renderRefPreview()      — rebuild the preview grid from the
//                              current file list.
//   removeRefAt(i)          — remove the i-th file from the input.
//   onReferencesChanged()   — re-render previews and refresh the hint.
//                              Call after kind switch (so role badges
//                              update) and after cap change (so the
//                              hint updates).
//
// State:
//   currentRefMax     — effective cap for the selected model. Set by
//                       the capabilities module. Read by the hint
//                       renderer.
//   refObjectURLs     — list of URLs we've created. Tracked so we
//                       can revoke them when the file list changes.
//
// The capabilities module owns the per-model cap value, but
// references.js owns the per-cap UI (the hint, the over-cap error).
// Keeping the cap value in capabilities and the rendering in
// references means each module stays focused on one concern.

import {
  getForm,
  getRefInput,
  getRefHelp,
  getRefPreview,
  getButton,
  getStatus,
} from './dom.js'
import { setStatus } from './status.js'
import { currentType } from './kind.js'

// Hard cap on the number of reference images (must match the server).
// This is the *default* cap when no model is selected (or the selected
// model doesn't expose `input_references` in its param_details). When
// a model is picked, the cap is replaced by the model's actual max
// (e.g. Grok Imagine allows 0–3 refs). See `currentRefMax` below.
const MAX_REFS = 16

export function getMAX_REFS() {
  return MAX_REFS
}

// currentRefMax is the effective per-model cap on reference images.
// Updated by applyCapabilitiesFromData when the model exposes an
// `input_references` range. The default (no model) is MAX_REFS.
let _currentRefMax = MAX_REFS
export function getCurrentRefMax() { return _currentRefMax }
export function setCurrentRefMax(v) { _currentRefMax = v }

// Track the object URLs we created so we can revoke them when the file list
// changes (avoids memory leaks).
let refObjectURLs = []

// Callback invoked after each refreshRefHint() so the orchestrator can
// update the Generate button's disabled state, etc. The capabilities
// module doesn't need to know about the button.
let _onChange = () => {}

export function initReferences({ onChange } = {}) {
  _onChange = onChange || _onChange
  const refInput = getRefInput()
  if (refInput) {
    refInput.addEventListener('change', () => {
      // If the user picked more than the per-model cap, we keep their full
      // selection (don't silently drop — that would surprise them) and
      // surface the error via refreshRefHint. The user can then remove
      // files from the preview grid until they're under the cap.
      refreshRefHint()
      renderRefPreview()
      _onChange()
    })
  }
}

// Re-render the preview grid and refresh the hint. Called after
// kind switch (role badges depend on kind) and after the cap
// changes (hint may show a new max).
export function onReferencesChanged() {
  refreshRefHint()
  renderRefPreview()
  _onChange()
}

export function refreshRefHint() {
  const refInput = getRefInput()
  const refHelp = getRefHelp()
  const button = getButton()
  const status = getStatus()
  if (!refHelp) return

  // Update the small hint next to the file input to reflect the current
  // mode and the *per-model* reference image cap. The cap is updated
  // by applyCapabilitiesFromData when the model exposes an
  // `input_references` range; we fall back to MAX_REFS otherwise.
  const files = refInput.files ? Array.from(refInput.files) : []
  const count = files.length
  const kind = currentType()
  const modeLabel = kind === 'image' ? 'image-to-image' : 'image-to-video'
  const overCap = count > _currentRefMax
  const perModelNote = _currentRefMax !== MAX_REFS
    ? ` (this model allows up to ${_currentRefMax})`
    : ''

  if (count === 0) {
    refHelp.textContent = `(optional — up to ${_currentRefMax}${perModelNote}, turns it into ${modeLabel})`
  } else {
    const suffix = overCap ? '⚠️ over cap' : `will run as ${modeLabel} ✨`
    refHelp.textContent = `(${count}/${_currentRefMax} selected — ${suffix})${perModelNote}`
  }
  refHelp.style.color = overCap ? 'var(--red)' : ''
  if (button) button.disabled = overCap
  if (overCap) {
    setStatus('error', `❌ Too many reference images: ${count} (max ${_currentRefMax} for this model). Remove some and try again.`)
  } else if (status && status.classList.contains('status--error') && status.textContent.startsWith('❌ Too many')) {
    setStatus('idle', 'Ready')
  }
}

// ---- reference image thumbnails ----
export function renderRefPreview() {
  const refInput = getRefInput()
  const refPreview = getRefPreview()
  if (!refPreview) return

  // Revoke any previously-issued object URLs to avoid leaks.
  for (const url of refObjectURLs) URL.revokeObjectURL(url)
  refObjectURLs = []

  const files = refInput.files ? Array.from(refInput.files) : []
  refPreview.innerHTML = ''
  if (files.length === 0) {
    refPreview.hidden = true
    return
  }
  refPreview.hidden = false

  const n = files.length
  const isVideo = currentType() === 'video'
  for (let i = 0; i < n; i++) {
    const file = files[i]
    const url = URL.createObjectURL(file)
    refObjectURLs.push(url)

    const thumb = document.createElement('div')
    thumb.className = 'ref-thumb'

    // Image wrapper — contains the <img> plus the absolutely-positioned
    // overlays (idx pill, role badge, remove button). The name strip
    // lives as a sibling below this wrapper so it has its own row and
    // can show the full filename (wrapping if needed, selectable for
    // copy-to-clipboard).
    const imgWrap = document.createElement('div')
    imgWrap.className = 'ref-img'

    const img = document.createElement('img')
    img.src = url
    img.alt = file.name || `Reference ${i + 1}`
    img.loading = 'lazy'
    imgWrap.appendChild(img)

    // Index pill (top-left) shows position in the list.
    const idx = document.createElement('span')
    idx.className = 'idx'
    idx.textContent = `#${i + 1}`
    imgWrap.appendChild(idx)

    // Role badge (bottom-left) — only meaningful for video (i2v), where the
    // SDK distinguishes first_frame vs last_frame. For image refs we skip
    // the badge entirely; the file name is enough.
    if (isVideo) {
      let label = null
      if (n >= 2 && i === n - 1) label = 'Last frame'
      else if (i === 0) label = 'First frame'
      if (label) {
        const badge = document.createElement('span')
        badge.className = 'badge'
        badge.textContent = label
        imgWrap.appendChild(badge)
      }
    }

    // Remove button (top-right over the image) — only visible on hover.
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'remove'
    remove.setAttribute('aria-label', `Remove ${file.name || 'reference ' + (i + 1)}`)
    remove.textContent = '\u2715'
    remove.addEventListener('click', (ev) => {
      ev.preventDefault()
      removeRefAt(i)
    })
    imgWrap.appendChild(remove)

    // Image on top, filename strip below — append the image wrapper
    // first, then the name, so the flex column renders in the right
    // order (image → name).
    thumb.appendChild(imgWrap)

    // File name — always shown, full text (no ellipsis), wraps to
    // multiple lines if needed, and is selectable so the user can copy
    // it to the clipboard.
    const name = document.createElement('span')
    name.className = 'name'
    name.title = file.name || '' // full name on hover
    name.textContent = file.name || `Reference ${i + 1}`
    thumb.appendChild(name)

    refPreview.appendChild(thumb)
  }
}

// Remove the i-th reference from the file input and re-render.
export function removeRefAt(i) {
  const refInput = getRefInput()
  if (!refInput.files || i < 0 || i >= refInput.files.length) return
  const dt = new DataTransfer()
  const files = Array.from(refInput.files)
  for (let j = 0; j < files.length; j++) {
    if (j !== i) dt.items.add(files[j])
  }
  refInput.files = dt.files
  refreshRefHint()
  renderRefPreview()
  _onChange()
}
