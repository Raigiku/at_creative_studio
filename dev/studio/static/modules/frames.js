// modules/frames.js
//
// First/last frame anchor inputs (video only). State-driven: the
// input's change handler updates state.frameFirstFile / frameLastFile,
// and render() rebuilds the preview thumbnails.

import { state, subscribe, setState } from './state.js'

// Object URLs are tracked per-slot so we can revoke them on the next
// render of that slot.
const frameObjectURLs = { first: null, last: null }

// renderFrames — pure read of state.frameFirstFile / frameLastFile.
function renderFrames() {
  renderSlot('first', state.frameFirstFile, document.getElementById('frame_first_preview'))
  renderSlot('last', state.frameLastFile, document.getElementById('frame_last_preview'))
}

function renderSlot(slot, file, previewEl) {
  // Revoke any previous URL for this slot.
  if (frameObjectURLs[slot]) {
    URL.revokeObjectURL(frameObjectURLs[slot])
    frameObjectURLs[slot] = null
  }
  if (!previewEl) return
  previewEl.innerHTML = ''
  if (!file) {
    previewEl.hidden = true
    return
  }
  previewEl.hidden = false

  const url = URL.createObjectURL(file)
  frameObjectURLs[slot] = url

  const img = document.createElement('img')
  img.src = url
  img.alt = file.name || `Frame ${slot}`
  previewEl.appendChild(img)

  const name = document.createElement('span')
  name.className = 'name'
  name.textContent = file.name || ''
  name.title = file.name || ''
  previewEl.appendChild(name)

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'remove'
  remove.setAttribute('aria-label', `Remove ${file.name || 'frame'}`)
  remove.textContent = '×'
  remove.addEventListener('click', (ev) => {
    ev.preventDefault()
    // Clear both the file input and the state.
    const inputEl = document.getElementById(slot === 'first' ? 'frame_first' : 'frame_last')
    if (inputEl) inputEl.value = ''
    setState(slot === 'first' ? { frameFirstFile: null } : { frameLastFile: null })
  })
  previewEl.appendChild(remove)
}

export function initFrames() {
  const firstInput = document.getElementById('frame_first')
  const lastInput  = document.getElementById('frame_last')
  if (firstInput) {
    firstInput.addEventListener('change', () => {
      setState({ frameFirstFile: firstInput.files && firstInput.files[0] || null })
    })
  }
  if (lastInput) {
    lastInput.addEventListener('change', () => {
      setState({ frameLastFile: lastInput.files && lastInput.files[0] || null })
    })
  }
  subscribe(renderFrames)
}
