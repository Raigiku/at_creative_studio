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
  video: '16:9',
}

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
}

for (const radio of form.querySelectorAll('input[name=type]')) {
  radio.addEventListener('change', () => {
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
        thumb.appendChild(badge)
      }
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
