// Creative Studio frontend
// Vanilla JS — no framework, no build step.

// Full aspect-ratio enums from the OpenRouter SDK.
const ASPECT_RATIOS = {
  image: [
    "1:1","1:2","1:4","1:8","2:1","2:3","3:2","3:4","4:1","4:3",
    "4:5","5:4","8:1","9:16","16:9","9:19.5","19.5:9","9:20","20:9","9:21","21:9",
    "auto",
  ],
  video: [
    "16:9","9:16","1:1","4:3","3:4","3:2","2:3","21:9","9:21",
  ],
}

// Default aspect ratio per kind. Used as the initial value on page load
// and when the user switches the Output (image/video) selector.
const DEFAULT_ASPECT = {
  image: '1:1',
  video: '1:1',
}

// Default duration (seconds) for video. Server clamps to 1..10.
const DEFAULT_DURATION = 5

// Default resolution for video (also pre-selected in the dropdown).
const DEFAULT_RESOLUTION = '720p'

// Default W×H size (used as the pre-filled value of the size input on
// initial load and on type-change, so the user never has to retype it).
const DEFAULT_SIZE = '1280x720'

// Quick-pick buttons in the row of pills. Each must exist in the enum above
// (or be the empty "Provider default").
const QUICK_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:2"]

const form = document.getElementById('gen-form')
const status = document.getElementById('status')
const preview = document.getElementById('preview')
const button = document.getElementById('generate-btn')
const refInput = document.getElementById('ref')
const refHelp = document.getElementById('ref-help')
const refPreview = document.getElementById('ref-preview')
const aspectHidden = document.getElementById('aspect_ratio')
const aspectMore = document.getElementById('aspect_ratio_select')
const ratiosBar = document.getElementById('ratios')

// Hard cap on the number of reference images (must match the server).
const MAX_REFS = 16

// Track the object URLs we created so we can revoke them when the file list
// changes (avoids memory leaks).
let refObjectURLs = []

// type value (form.type.value) is "image" or "video" and matches the SDK
// endpoint directly. The presence of a reference image is what makes it
// "image-to-image" / "image-to-video".
let models = { image: [], video: [] }
let currentKind = 'image' // tracks which set of "More..." options to show

function setStatus(state, message) {
  status.className = `status status--visible status--${state}`
  status.textContent = message
}

function currentType() {
  return form.type.value // "image" | "video"
}

function refreshRefHint() {
  // Update the small hint next to the file input to reflect the current mode,
  // and enforce the max-16 reference image cap client-side.
  const files = refInput.files ? Array.from(refInput.files) : []
  const count = files.length
  const kind = currentType()
  const modeLabel = kind === 'image' ? 'image-to-image' : 'image-to-video'
  const overCap = count > MAX_REFS

  if (count === 0) {
    refHelp.textContent = `(optional — up to ${MAX_REFS}, turns it into ${modeLabel})`
  } else {
    const suffix = overCap ? '⚠️ over cap' : `will run as ${modeLabel} ✨`
    refHelp.textContent = `(${count}/${MAX_REFS} selected — ${suffix})`
  }
  refHelp.style.color = overCap ? 'var(--red)' : ''
  button.disabled = overCap
  if (overCap) {
    setStatus('error', `❌ Too many reference images: ${count} (max ${MAX_REFS}). Remove some and try again.`)
  } else if (status.classList.contains('status--error') && status.textContent.startsWith('❌ Too many')) {
    setStatus('idle', 'Ready')
  }
}

// ---- model dropdown ----
function refreshModelOptions() {
  const type = currentType() // "image" | "video"
  const select = form.model
  const list = models[type] || []
  select.innerHTML = ''
  if (list.length === 0) {
    const opt = document.createElement('option')
    opt.textContent = '(no models available — check API key) 🔑'
    select.appendChild(opt)
    return
  }
  for (const m of list) {
    const opt = document.createElement('option')
    opt.value = m.id
    opt.textContent = m.name
    select.appendChild(opt)
  }
}

// ---- show/hide image vs video fields ----
function refreshKindVisibility() {
  const kind = currentType() // "image" | "video"
  for (const el of form.querySelectorAll('[data-show]')) {
    if (el.dataset.show === kind) el.removeAttribute('hidden')
    else el.setAttribute('hidden', '')
    // Disable hidden fields so they don't ride along in the form submission.
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
function refreshResolutionSelect() {
  const kind = currentType()
  for (const sel of form.querySelectorAll('select[name=resolution]')) {
    sel.disabled = sel.dataset.resKind !== kind
  }
}

// ---- aspect-ratio pills + "More..." dropdown ----
function buildAspectRatioOptions(kind) {
  aspectMore.innerHTML = ''
  for (const v of ASPECT_RATIOS[kind]) {
    const opt = document.createElement('option')
    opt.value = v
    opt.textContent = v
    aspectMore.appendChild(opt)
  }
  aspectMore.value = ''
  // Hide the "More..." dropdown if it adds nothing beyond the pills.
  const moreWrap = aspectMore.parentElement
  moreWrap.style.display = ASPECT_RATIOS[kind].some(r => !QUICK_RATIOS.includes(r) && r !== 'auto') ? '' : 'none'
}

function setAspectActive(value) {
  // Toggle pill states.
  for (const pill of ratiosBar.querySelectorAll('.pill')) {
    pill.classList.toggle('active', pill.dataset.value === value)
  }
  // Sync the hidden form field.
  aspectHidden.value = value || ''
  // If the value isn't on a quick-pick, set the "More..." dropdown to it
  // (and otherwise leave it empty so the dropdown doesn't show a stale value
  // that contradicts the active pill).
  if (value && !QUICK_RATIOS.includes(value) && ASPECT_RATIOS[currentKind].includes(value)) {
    aspectMore.value = value
  } else {
    aspectMore.value = ''
  }
}

for (const pill of ratiosBar.querySelectorAll('.pill')) {
  pill.addEventListener('click', () => setAspectActive(pill.dataset.value))
}
aspectMore.addEventListener('change', () => setAspectActive(aspectMore.value))

// ---- size mode switcher (video only) ----
// The user picks ONE of two modes via a segmented control:
//   * "aspect"  → the 📐 Aspect ratio section is visible (aspect pills + resolution)
//   * "size"    → that section is hidden and the 📏 Size W×H input takes over
// Default is "aspect" so the user sees the familiar aspect + resolution first.
const sizeInput = document.getElementById('size_vid')

function getSizeMode() {
  const checked = form.querySelector('input[name=size_mode]:checked')
  return checked ? checked.value : 'aspect' // default = aspect
}

function applySizeMode() {
  const mode = getSizeMode()
  const isVideo = currentType() === 'video'
  // Toggle the Aspect ratio section (section-wide hide/show). For image mode
  // the section is always visible regardless of the size mode picker, so we
  // force it open when not in video mode.
  const aspectSection = form.querySelector('[data-mode-section="aspect"]')
  if (aspectSection) {
    if (!isVideo || mode === 'aspect') aspectSection.removeAttribute('hidden')
    else aspectSection.setAttribute('hidden', '')
  }
  // Toggle the Size W×H field.
  const sizeField = form.querySelector('[data-mode-section="size"]')
  if (sizeField) {
    if (isVideo && mode === 'size') sizeField.removeAttribute('hidden')
    else sizeField.setAttribute('hidden', '')
  }
  // Form data hygiene: `hidden` on a parent doesn't exclude inputs from
  // FormData, so we explicitly `disabled` the inactive group too. The
  // `disabled` attribute alone is enough to keep stale values out of the
  // submitted form, so we DON'T clear the inactive group's value here —
  // that lets the user preserve their inputs when toggling modes.
  const resEl = document.getElementById('resolution_vid')
  if (resEl) resEl.disabled = !isVideo || mode === 'size'
  if (sizeInput) sizeInput.disabled = !isVideo || mode !== 'size'
  // The hidden `aspect_ratio` form field always reflects the pill state;
  // clear it when switching to size mode so the user sees a clean reset
  // (the form value mirrors the pills, which are now hidden).
  if (isVideo && mode === 'size') {
    setAspectActive('')
  }
}

form.querySelectorAll('input[name=size_mode]').forEach((r) => {
  r.addEventListener('change', applySizeMode)
})

// Auto-switch helpers: typing in size, picking a resolution, or picking an
// aspect pill all jump the picker to the matching mode.
sizeInput.addEventListener('input', () => {
  if (sizeInput.value.trim() !== '' && getSizeMode() !== 'size') {
    document.getElementById('size_mode-size').checked = true
    applySizeMode()
  }
})
const resolutionSelEarly = document.getElementById('resolution_vid')
resolutionSelEarly.addEventListener('change', () => {
  if (resolutionSelEarly.value && getSizeMode() !== 'aspect') {
    document.getElementById('size_mode-aspect').checked = true
    applySizeMode()
  }
})
for (const pill of ratiosBar.querySelectorAll('.pill')) {
  pill.addEventListener('click', () => {
    if (getSizeMode() !== 'aspect') {
      document.getElementById('size_mode-aspect').checked = true
      applySizeMode()
    }
  })
}

// ---- main refresh when type changes ----
function refreshAll() {
  const kind = currentType() // "image" | "video"
  currentKind = kind
  buildAspectRatioOptions(kind)
  // Always set the per-kind default. setAspectActive is a no-op for the
  // active pill state if the hidden field already has the same value, so
  // it's safe to call every time.
  setAspectActive(DEFAULT_ASPECT[kind] || '')
  refreshModelOptions()
  refreshKindVisibility()
  refreshResolutionSelect()
  refreshRefHint()
  applySizeMode()
}

for (const radio of form.querySelectorAll('input[name=type]')) {
  radio.addEventListener('change', () => {
    // Reset video-specific fields to their per-kind defaults so the user
    // never carries over a stale 1080p + 9:16 from an image session.
    const durationEl = document.getElementById('duration')
    const sizeEl = document.getElementById('size_vid')
    const resEl = document.getElementById('resolution_vid')
    if (durationEl) durationEl.value = String(DEFAULT_DURATION)
    if (sizeEl) sizeEl.value = DEFAULT_SIZE
    if (resEl) resEl.value = DEFAULT_RESOLUTION
    // Reset size mode back to "aspect" so the user always starts with the
    // familiar aspect + resolution view.
    const sizeModeDefault = document.getElementById('size_mode-aspect')
    if (sizeModeDefault) sizeModeDefault.checked = true
    // Clear the first/last frame inputs when switching modes — they only
    // make sense for video, and we don't want stale image bytes riding
    // along on an image request.
    if (frameFirstInput) {
      frameFirstInput.value = ''
      renderFramePreview(frameFirstInput, frameFirstPreview, 'First frame', frameFirstURLRef)
    }
    if (frameLastInput) {
      frameLastInput.value = ''
      renderFramePreview(frameLastInput, frameLastPreview, 'Last frame', frameLastURLRef)
    }
    refreshAll()
    // Re-render so the First/Last frame badges reflect the new mode.
    if (refInput.files && refInput.files.length > 0) renderRefPreview()
  })
}

// ---- reference image thumbnails ----
function renderRefPreview() {
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

    const img = document.createElement('img')
    img.src = url
    img.alt = file.name || `Reference ${i + 1}`
    img.loading = 'lazy'
    thumb.appendChild(img)

    // Index pill (top-left) shows position in the list.
    const idx = document.createElement('span')
    idx.className = 'idx'
    idx.textContent = `#${i + 1}`
    thumb.appendChild(idx)

    // Role badge (bottom-left) — for video, ref images are all "Reference #N"
    // since first/last frame are now in their own dedicated inputs.
    if (isVideo) {
      const badge = document.createElement('span')
      badge.className = 'badge badge--ref'
      badge.textContent = `Ref #${i + 1}`
      thumb.appendChild(badge)
    }

    // File name (bottom) — always shown, ellipsised if too long.
    const name = document.createElement('span')
    name.className = 'name'
    name.title = file.name || '' // full name on hover
    name.textContent = file.name || `Reference ${i + 1}`
    thumb.appendChild(name)

    // Remove button (top-right) — only visible on hover.
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'remove'
    remove.setAttribute('aria-label', `Remove ${file.name || 'reference ' + (i + 1)}`)
    remove.textContent = '✕'
    remove.addEventListener('click', (ev) => {
      ev.preventDefault()
      removeRefAt(i)
    })
    thumb.appendChild(remove)

    refPreview.appendChild(thumb)
  }
}

// Remove the i-th reference from the file input and re-render.
function removeRefAt(i) {
  if (!refInput.files || i < 0 || i >= refInput.files.length) return
  const dt = new DataTransfer()
  const files = Array.from(refInput.files)
  for (let j = 0; j < files.length; j++) {
    if (j !== i) dt.items.add(files[j])
  }
  refInput.files = dt.files
  refreshRefHint()
  renderRefPreview()
}

refInput.addEventListener('change', () => {
  // If the user picked more than MAX_REFS, drop the over-the-cap ones so
  // the form never even carries them to the server.
  if (refInput.files && refInput.files.length > MAX_REFS) {
    const dt = new DataTransfer()
    for (let i = 0; i < MAX_REFS; i++) {
      dt.items.add(refInput.files[i])
    }
    refInput.files = dt.files
  }
  refreshRefHint()
  renderRefPreview()
})

// ---- single-image first / last frame inputs (video only) ----
// These are independent of the multi-image "ref" input: each is one image
// that the server forwards as FrameImages[].FrameType = first_frame / last_frame.
const frameFirstInput = document.getElementById('frame_first')
const frameLastInput = document.getElementById('frame_last')
const frameFirstPreview = document.getElementById('frame_first_preview')
const frameLastPreview = document.getElementById('frame_last_preview')
let frameFirstObjectURL = null
let frameLastObjectURL = null

function renderFramePreview(input, preview, label, objectURLRef) {
  // Render a single-image preview with a remove button. We keep the previous
  // object URL on a closure variable so we can revoke it on the next change.
  if (objectURLRef.url) URL.revokeObjectURL(objectURLRef.url)
  preview.innerHTML = ''
  const file = input.files && input.files[0]
  if (!file) {
    objectURLRef.url = null
    preview.hidden = true
    return
  }
  const url = URL.createObjectURL(file)
  objectURLRef.url = url

  const img = document.createElement('img')
  img.src = url
  img.alt = file.name || label
  preview.appendChild(img)

  const lbl = document.createElement('span')
  lbl.className = 'label'
  lbl.textContent = label
  preview.appendChild(lbl)

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'remove'
  remove.setAttribute('aria-label', `Remove ${label}`)
  remove.textContent = '✕'
  remove.addEventListener('click', (ev) => {
    ev.preventDefault()
    input.value = '' // single input: just blank it
    renderFramePreview(input, preview, label, objectURLRef)
  })
  preview.appendChild(remove)

  preview.hidden = false
}

const frameFirstURLRef = { url: null }
const frameLastURLRef = { url: null }

frameFirstInput.addEventListener('change', () => {
  renderFramePreview(frameFirstInput, frameFirstPreview, 'First frame', frameFirstURLRef)
})
frameLastInput.addEventListener('change', () => {
  renderFramePreview(frameLastInput, frameLastPreview, 'Last frame', frameLastURLRef)
})

// On load: fetch the model list
;(async () => {
  try {
    const m = await fetch('/api/models').then(r => r.json())
    models = m
    refreshAll()
    setAspectActive(DEFAULT_ASPECT[currentKind] || '1:1') // ensure default state
  } catch (err) {
    setStatus('error', `Failed to initialize: ${err.message}`)
  }
})()

// ---- submit ----
form.addEventListener('submit', async (e) => {
  e.preventDefault()

  // Required-field guard: `required` is set on the prompt <textarea>, but
  // because we call preventDefault() the browser never gets a chance to
  // run its native validation. We check explicitly here so the user gets
  // a friendly status-bar message instead of a silent no-op.
  const promptEl = document.getElementById('prompt')
  if (!promptEl || promptEl.value.trim() === '') {
    setStatus('error', '❌ Prompt is required — describe what you want to generate.')
    if (promptEl) promptEl.focus()
    return
  }

  preview.innerHTML = ''
  button.disabled = true
  setStatus('generating', 'Submitting to OpenRouter... 🚀')

  // Build FormData from a fresh form snapshot so disabled fields are excluded.
  const data = new FormData(form)

  try {
    const res = await fetch('/api/generate', { method: 'POST', body: data })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)

    if (body.kind === 'image') {
      setStatus('done', `✅ Saved: ${body.path}`)
      const img = document.createElement('img')
      img.src = body.url
      img.alt = 'Generated image'
      preview.appendChild(img)
    } else if (body.kind === 'video') {
      setStatus('done', `✅ Saved: ${body.path}`)
      const video = document.createElement('video')
      video.src = body.url
      video.controls = true
      video.autoplay = true
      preview.appendChild(video)
    }
  } catch (err) {
    setStatus('error', `❌ ${err.message || String(err)}`)
  } finally {
    button.disabled = false
  }
})
