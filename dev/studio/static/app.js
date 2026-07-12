// Creative Studio frontend
// Vanilla JS â€” no framework, no build step.

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

// WxH pattern for the "Exact size" field. Mirrors the server-side
// `sizePattern` in dev/studio/params.go and the `pattern=` attribute on
// the size input in index.html, so client-side validity, server-side
// validation, and the live override behavior all agree.
const sizePattern = /^[1-9][0-9]{1,4}x[1-9][0-9]{1,4}$/

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
    refHelp.textContent = `(optional â€” up to ${MAX_REFS}, turns it into ${modeLabel})`
  } else {
    const suffix = overCap ? 'âš ï¸ over cap' : `will run as ${modeLabel} âœ¨`
    refHelp.textContent = `(${count}/${MAX_REFS} selected â€” ${suffix})`
  }
  refHelp.style.color = overCap ? 'var(--red)' : ''
  button.disabled = overCap
  if (overCap) {
    setStatus('error', `âŒ Too many reference images: ${count} (max ${MAX_REFS}). Remove some and try again.`)
  } else if (status.classList.contains('status--error') && status.textContent.startsWith('âŒ Too many')) {
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
    opt.textContent = '(no models available â€” check API key) ðŸ”‘'
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
const sizeInput = document.getElementById('size_vid')
// Walk up from the hidden aspect_ratio input to find the enclosing
// <div class="section">. We don't use :has() so this works in every
// browser shipped in the last few years.
function sectionOf(el) {
  while (el && el !== form) {
    if (el.classList && el.classList.contains('section')) return el
    el = el.parentElement
  }
  return null
}
const aspectSection = sectionOf(document.getElementById('aspect_ratio'))
const resolutionField = form.querySelector('select[name=resolution][data-res-kind="video"]')?.closest('.field')
const resolutionSel = form.querySelector('select[name=resolution][data-res-kind="video"]')

function refreshSizeOverride() {
  // Only meaningful in video mode — in image mode the size field is
  // hidden anyway (data-show="video" on its wrapper).
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

if (sizeInput) sizeInput.addEventListener('input', refreshSizeOverride)

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
  refreshSizeOverride()
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

    // Role badge (bottom-left) â€” only meaningful for video (i2v), where the
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

    // File name (bottom) â€” always shown, ellipsised if too long.
    const name = document.createElement('span')
    name.className = 'name'
    name.title = file.name || '' // full name on hover
    name.textContent = file.name || `Reference ${i + 1}`
    thumb.appendChild(name)

    // Remove button (top-right) â€” only visible on hover.
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'remove'
    remove.setAttribute('aria-label', `Remove ${file.name || 'reference ' + (i + 1)}`)
    remove.textContent = 'âœ•'
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

// Map server `code` values to a short emoji prefix. Keep this in sync with
// the errCode* constants in main.go.
const ERROR_ICON = {
  auth: 'ðŸ”‘',
  quota: 'ðŸ’¸',
  rate_limit: 'â³',
  unsupported_fields: 'ðŸš«',
  bad_request: 'âš ï¸',
  moderation: 'ðŸ›‘',
  upstream: 'â˜ï¸',
  network: 'ðŸŒ',
  video_failed: 'ðŸŽ¬',
  internal: 'âŒ',
}

// Remember the most recent failed request so the "Retry" button can
// resubmit it without the user re-filling the form. Cleared on success.
let lastFailedRequest = null
let lastFailedFields = null   // unsupportedFields from the last error, if any

// Show an error in the status bar. `opts.retryable` and
// `opts.unsupportedFields` add a button.
function showGenError(body) {
  const icon = ERROR_ICON[body.code] || 'âŒ'
  const retryable = !!body.retryable
  const fields = Array.isArray(body.unsupportedFields) ? body.unsupportedFields : []

  // Build the message. We append a short "Retry" hint when the user can act.
  let msg = `${icon} ${body.error || 'Unknown error'}`
  if (fields.length > 0) {
    msg += `\n   Disabling: ${fields.join(', ')}`
  }
  setStatus('error', msg)

  // Append a Retry button (without nuking the message). We rebuild the
  // status node's children to keep the text node and the button side by side.
  if (retryable) {
    const existing = status.querySelector('.retry-btn')
    if (existing) existing.remove()
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'retry-btn'
    btn.textContent = fields.length > 0 ? 'â†» Retry without these fields' : 'â†» Retry'
    btn.style.cssText = 'margin-left:10px;font:inherit;font-size:12px;padding:3px 10px;border:0;border-radius:6px;background:var(--surface-3);color:var(--text);cursor:pointer;'
    btn.addEventListener('click', () => {
      // Two flavors of retry:
      //  - The model rejected some fields: we want to send the SAME body
      //    minus those fields. Snapshot + disable + resubmit.
      //  - The provider was down / rate-limited: the user may have edited
      //    the form in the meantime, so just resubmit whatever the form
      //    has now.
      if (fields.length > 0) {
        disableFields(fields)
        submitGenerate({ isRetry: true, resendSnapshot: true })
      } else {
        submitGenerate({ isRetry: true, resendSnapshot: false })
      }
    })
    status.appendChild(btn)
  }
}

// Disable the named form fields (and their inner inputs) so the next
// FormData build excludes them. Used when the server tells us the model
// rejected some params.
function disableFields(names) {
  for (const name of names) {
    // Match by `name=` (covers all <input>, <select>, <textarea> with
    // that attribute) and also the dedicated id-based controls.
    for (const el of form.querySelectorAll(`[name="${CSS.escape(name)}"]`)) {
      el.disabled = true
    }
    // Special: the reference image file input has name="ref", handled above.
    // Special: frame_first / frame_last are file inputs with the matching name.
    // Special: the aspect_ratio dropdown also writes to a hidden field with
    // the same name; disabling the dropdown disables the user-facing control
    // but the hidden field still has its value â€” that's fine, FormData
    // includes hidden disabled inputs? It does NOT â€” disabled inputs are
    // excluded from form submission, same as a select. So we need to clear
    // the hidden aspect_ratio field if the server says aspect_ratio is
    // unsupported.
    if (name === 'aspect_ratio' && aspectHidden) aspectHidden.value = ''
    if (name === 'generate_audio') {
      const cb = form.querySelector('input[name="generate_audio"]')
      if (cb) cb.checked = false
    }
    if (name === 'n') {
      const n = form.querySelector('input[name="n"]')
      if (n) n.value = '1'
    }
    if (name === 'seed') {
      const s = form.querySelector('input[name="seed"]')
      if (s) s.value = ''
    }
    if (name === 'output_compression') {
      const c = form.querySelector('input[name="output_compression"]')
      if (c) c.value = '100'
    }
    if (name === 'duration') {
      const d = form.querySelector('input[name="duration"]')
      if (d) d.value = '5'
    }
    if (name === 'size') {
      // Server says the model doesn't support `size`. The natural
      // fallback is to clear the override so the user goes back to
      // using aspect_ratio + resolution, which are universally
      // supported.
      const sz = form.querySelector('input[name="size"]')
      if (sz) sz.value = ''
      refreshSizeOverride()
    }
  }
  // Re-run a couple of UI refreshes so the disabled state is visible
  // (e.g. the reference picker goes muted).
  refreshKindVisibility()
  refreshResolutionSelect()
  refreshRefHint()
}

// Build a small "Download ⬇ / Open ↗" bar to drop under a generated preview.
// The `download` attribute on the anchor is what makes the browser save the
// file with the original name (instead of routing to the in-page video
// element) when the user clicks Download. "Open in new tab" is for the case
// where the user wants to grab a different-format copy later.
function buildDownloadBar(url, path) {
  const bar = document.createElement('div')
  bar.className = 'download-bar'

  const a = document.createElement('a')
  a.className = 'download-btn'
  a.href = url
  a.download = path || ''
  a.textContent = '⬇ Download'
  bar.appendChild(a)

  const open = document.createElement('a')
  open.className = 'download-btn download-btn--ghost'
  open.href = url
  open.target = '_blank'
  open.rel = 'noopener'
  open.textContent = '↗ Open'
  bar.appendChild(open)

  // Tiny path hint so the user can see the on-disk filename without opening
  // a terminal. Truncated in CSS for very long paths.
  const hint = document.createElement('span')
  hint.className = 'download-hint'
  hint.title = path || ''
  hint.textContent = `ai_outputs/${path || ''}`
  bar.appendChild(hint)

  return bar
}

// Submit helper. `opts.isRetry` is true when called from the Retry button.
// `opts.resendSnapshot` is true when we want to re-send the *exact* body
// that previously failed (after disabling some fields), false when the
// user has since edited the form and we should re-serialize.
async function submitGenerate(opts = {}) {
  const { isRetry = false, resendSnapshot = false } = opts
  preview.innerHTML = ''
  button.disabled = true
  // Clear any previous retry button before showing the new status.
  const oldBtn = status.querySelector('.retry-btn')
  if (oldBtn) oldBtn.remove()
  setStatus('generating', isRetry ? 'Retrying... ðŸ”' : 'Submitting to OpenRouter... ðŸš€')

  let data
  if (isRetry && resendSnapshot && lastFailedRequest) {
    // We disabled the offending fields in the form, but the FormData
    // snapshot was built BEFORE that disable. Re-build a fresh FormData
    // from the form so the disabled fields are excluded â€” the user's
    // other edits since the original failure are also picked up here.
    data = new FormData(form)
  } else if (isRetry) {
    // Plain retry (no field removal). Reserialize from the form so any
    // edits the user made are respected.
    data = new FormData(form)
  } else {
    // First attempt: build FormData from a fresh form snapshot so
    // disabled fields are excluded.
    data = new FormData(form)
  }
  // Always remember the body we're about to send so a future
  // "Retry without these fields" can re-send it after disabling.
  lastFailedRequest = data
  lastFailedFields = null

  try {
    const res = await fetch('/api/generate', { method: 'POST', body: data })
    // Parse body as JSON regardless of status â€” the server always returns
    // our genError shape on failure.
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      lastFailedFields = Array.isArray(body.unsupportedFields) ? body.unsupportedFields : null
      throw body  // pass the whole body to the catch block
    }
    // Success â€” clear the failure memo so the form is fully re-serialized
    // on the next submit.
    lastFailedRequest = null
    lastFailedFields = null

    if (body.kind === 'image') {
      setStatus('done', `âœ… Saved: ${body.path}`)
      const img = document.createElement('img')
      img.src = body.url
      img.alt = 'Generated image'
      preview.appendChild(img)
      preview.appendChild(buildDownloadBar(body.url, body.path))
    } else if (body.kind === 'video') {
      setStatus('done', `✅ Saved: ${body.path}`)
      const video = document.createElement('video')
      video.src = body.url
      video.controls = true
      video.autoplay = true
      preview.appendChild(video)
      preview.appendChild(buildDownloadBar(body.url, body.path))
    }
  } catch (err) {
    // err may be our parsed body object (from `throw body`) or a network
    // error. Normalize to the genError shape.
    const body = (err && typeof err === 'object' && (err.error || err.code))
      ? err
      : { error: (err && err.message) || String(err), code: 'internal', retryable: false }
    showGenError(body)
  } finally {
    button.disabled = false
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault()
  submitGenerate({ isRetry: false, resendSnapshot: false })
})