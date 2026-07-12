// modules/references.js
//
// Reference image picker: the multi-file <input> plus the preview
// grid that shows each pick with a "First/Last frame" role badge
// (video mode only), an index pill, a remove button, and a
// selectable filename strip.
//
// State-driven: the only mutators are setRefFiles() (called from the
// input's change handler) and removeRefAt() (called from the
// preview's per-thumb remove button). Everything else is render.

import {
  getForm,
  getRefInput,
  getRefHelp,
  getRefPreview,
  getButton,
  getStatus,
} from './dom.js'
import { setStatus } from './status.js'
import { state, subscribe, setState } from './state.js'

// Hard cap on the number of reference images (must match the server).
// This is the *default* cap when no model is selected. When a model
// is picked, the cap is replaced by the model's actual max
// (e.g. Grok Imagine allows 0–3 refs). See state.refMax.
const MAX_REFS = 16
export function getMAX_REFS() { return MAX_REFS }

// Track the object URLs we've created so we can revoke them on the
// next render (avoids memory leaks).
let refObjectURLs = []

function emptyFileList() {
  return { length: 0, item: () => null, [Symbol.iterator]: function* () {} }
}

// renderReferences — pure read of state.refFiles / state.refMax / state.kind.
function renderReferences() {
  const refHelp = getRefHelp()
  const refPreview = getRefPreview()
  const button = getButton()
  const status = getStatus()
  if (!refHelp || !refPreview) return

  const files = state.refFiles || emptyFileList()
  const count = files.length
  const kind = state.kind
  const refMax = state.refMax
  const modeLabel = kind === 'image' ? 'image-to-image' : 'image-to-video'
  const overCap = count > refMax
  const perModelNote = refMax !== MAX_REFS
    ? ` (this model allows up to ${refMax})`
    : ''

  // ---- 1. Hint text ----
  if (count === 0) {
    refHelp.textContent = `(optional — up to ${refMax}${perModelNote}, turns it into ${modeLabel})`
  } else {
    const suffix = overCap ? '⚠️ over cap' : `will run as ${modeLabel} ✨`
    refHelp.textContent = `(${count}/${refMax} selected — ${suffix})${perModelNote}`
  }
  refHelp.style.color = overCap ? 'var(--red)' : ''
  if (button) button.disabled = overCap
  if (overCap) {
    setStatus('error', `❌ Too many reference images: ${count} (max ${refMax} for this model). Remove some and try again.`)
  } else if (status && status.classList.contains('status--error') && status.textContent.startsWith('❌ Too many')) {
    setStatus('idle', 'Ready')
  }

  // ---- 2. Preview grid ----
  // Revoke old URLs first.
  for (const url of refObjectURLs) URL.revokeObjectURL(url)
  refObjectURLs = []

  refPreview.innerHTML = ''
  if (count === 0) {
    refPreview.hidden = true
    return
  }
  refPreview.hidden = false

  const isVideo = kind === 'video'
  for (let i = 0; i < count; i++) {
    const file = files[i]
    const url = URL.createObjectURL(file)
    refObjectURLs.push(url)

    const thumb = document.createElement('div')
    thumb.className = 'ref-thumb'

    const imgWrap = document.createElement('div')
    imgWrap.className = 'ref-img'

    const img = document.createElement('img')
    img.src = url
    img.alt = file.name || `Reference ${i + 1}`
    img.loading = 'lazy'
    imgWrap.appendChild(img)

    const idx = document.createElement('span')
    idx.className = 'idx'
    idx.textContent = `#${i + 1}`
    imgWrap.appendChild(idx)

    if (isVideo) {
      let label = null
      if (count >= 2 && i === count - 1) label = 'Last frame'
      else if (i === 0) label = 'First frame'
      if (label) {
        const badge = document.createElement('span')
        badge.className = 'badge'
        badge.textContent = label
        imgWrap.appendChild(badge)
      }
    }

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

    thumb.appendChild(imgWrap)

    const name = document.createElement('span')
    name.className = 'name'
    name.title = file.name || ''
    name.textContent = file.name || `Reference ${i + 1}`
    thumb.appendChild(name)

    refPreview.appendChild(thumb)
  }
}

export function initReferences() {
  const refInput = getRefInput()
  if (refInput) {
    refInput.addEventListener('change', () => {
      // We keep the file list reference in state and re-render.
      // The user can have more than the cap; the over-cap error is
      // surfaced by the render pass.
      setState({ refFiles: refInput.files })
    })
  }
  subscribe(renderReferences)
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
  setState({ refFiles: refInput.files })
}

// Back-compat exports.
export function refreshRefHint() { renderReferences() }
export function renderRefPreview() { renderReferences() }
export function getCurrentRefMax() { return state.refMax }
export function setCurrentRefMax(v) { state.refMax = v }
