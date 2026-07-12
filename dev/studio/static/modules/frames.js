// modules/frames.js
//
// First/last frame anchor previews (video only). Each frame input
// has a sibling `.frame-preview` div that we populate with an image
// + a selectable filename strip + a remove button. Object URLs are
// tracked so we can revoke them when the file changes (no leaks).
//
// Public API:
//
//   initFrames() — wire up the change listeners for both frame inputs.
//
// No state crosses module boundaries; this module is purely presentational.

const frameFirstInput = document.getElementById('frame_first')
const frameLastInput  = document.getElementById('frame_last')
const frameFirstPrev  = document.getElementById('frame_first_preview')
const frameLastPrev   = document.getElementById('frame_last_preview')
const frameObjectURLs = { first: null, last: null }

function renderFramePreview(inputEl, previewEl, slot /* 'first' | 'last' */) {
  // Revoke any previous object URL for this slot.
  if (frameObjectURLs[slot]) {
    URL.revokeObjectURL(frameObjectURLs[slot])
    frameObjectURLs[slot] = null
  }
  previewEl.innerHTML = ''
  const file = inputEl.files && inputEl.files[0]
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

  // Bottom filename strip — full name, selectable so the user can
  // copy it to the clipboard. We let it wrap to multiple lines and
  // use a monospace font so the layout is predictable.
  const name = document.createElement('span')
  name.className = 'name'
  name.textContent = file.name || ''
  name.title = file.name || ''
  previewEl.appendChild(name)

  // Remove button — clears the file input and re-renders.
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'remove'
  remove.setAttribute('aria-label', `Remove ${file.name || 'frame'}`)
  remove.textContent = '×'
  remove.addEventListener('click', (ev) => {
    ev.preventDefault()
    inputEl.value = '' // clear the file input
    renderFramePreview(inputEl, previewEl, slot)
  })
  previewEl.appendChild(remove)
}

export function initFrames() {
  if (frameFirstInput && frameFirstPrev) {
    frameFirstInput.addEventListener('change', () => renderFramePreview(frameFirstInput, frameFirstPrev, 'first'))
  }
  if (frameLastInput && frameLastPrev) {
    frameLastInput.addEventListener('change', () => renderFramePreview(frameLastInput, frameLastPrev, 'last'))
  }
}
