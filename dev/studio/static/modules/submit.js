// modules/submit.js
//
// Form submission, retry flow, and the download-bar builder. State-
// driven: the form's submit handler reads state via setState(), the
// retry button reads state.lastFailedBody / state.lastFailedFields.
//
// Public API:
//   initSubmit()         — wire the form submit listener.
//   submitGenerate()     — POST /api/generate.
//   disableFields(names) — used by the Retry flow to remove fields
//                            the server rejected.
//
// State touched:
//   state.isSubmitting      — true while a request is in flight.
//   state.lastFailedBody    — FormData from the most recent failure.
//   state.lastFailedFields  — unsupportedFields from the most recent failure.

import { getForm, getPreview, getStatus } from './dom.js'
import { setStatus, ERROR_ICON } from './status.js'
import { setState, state } from './state.js'
import { getSizePattern } from './kind.js'

const sizePattern = getSizePattern()

// ---------------------------------------------------------------------------
// disableFields — used by the retry flow when the server tells us
// the model rejected some params. We disable the named fields in
// the form (so the next FormData snapshot omits them) and trigger
// a re-render so the UI reflects the new disabled state.
// ---------------------------------------------------------------------------
export function disableFields(names) {
  const form = getForm()
  if (!form) return
  for (const name of names) {
    for (const el of form.querySelectorAll(`[name="${CSS.escape(name)}"]`)) {
      el.disabled = true
    }
    if (name === 'aspect_ratio') {
      const ah = form.querySelector('input[name="aspect_ratio"]')
      if (ah) ah.value = ''
    }
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
      // Server says the model doesn't support `size`. Clear it.
      const sz = form.querySelector('input[name="size"]')
      if (sz) sz.value = ''
      setState({ sizeOverride: '' })
    }
  }
  // A re-render is needed because disabling inputs may have changed
  // the size-override logic (if `size` was just cleared).
  setState({}) // no-op patch that just triggers render
}

// ---------------------------------------------------------------------------
// showGenError — render an error in the status bar with an optional
// Retry button. The Retry button reads state.lastFailedFields and
// calls disableFields() + submitGenerate().
// ---------------------------------------------------------------------------
function showGenError(body) {
  const status = getStatus()
  if (!status) return
  const icon = ERROR_ICON[body.code] || '❌'
  const retryable = !!body.retryable
  const fields = Array.isArray(body.unsupportedFields) ? body.unsupportedFields : []

  let msg = `${icon} ${body.error || 'Unknown error'}`
  if (fields.length > 0) {
    msg += `\n   Disabling: ${fields.join(', ')}`
  }
  setStatus('error', msg)

  if (retryable) {
    const existing = status.querySelector('.retry-btn')
    if (existing) existing.remove()
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'retry-btn'
    btn.textContent = fields.length > 0 ? '↻ Retry without these fields' : '↻ Retry'
    btn.style.cssText = 'margin-left:10px;font:inherit;font-size:12px;padding:3px 10px;border:0;border-radius:6px;background:var(--surface-3);color:var(--text);cursor:pointer;'
    btn.addEventListener('click', () => {
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

// ---------------------------------------------------------------------------
// buildDownloadBar — Drop the "Download ⬇ / Open ↗" bar under a
// generated preview. Pure DOM construction, no state coupling.
// ---------------------------------------------------------------------------
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

  const hint = document.createElement('span')
  hint.className = 'download-hint'
  hint.title = path || ''
  hint.textContent = `ai_outputs/${path || ''}`
  bar.appendChild(hint)

  return bar
}

// ---------------------------------------------------------------------------
// submitGenerate — POST /api/generate. Pure side-effect function; it
// reads state, mutates state via setState() (for lastFailedBody, etc.),
// and updates the preview + status bar directly (those are submit-
// specific UI, not part of the steady-state form).
// ---------------------------------------------------------------------------
export async function submitGenerate(opts = {}) {
  const { isRetry = false, resendSnapshot = false } = opts
  const form = getForm()
  const preview = getPreview()
  const status = getStatus()
  if (!form) return

  preview.innerHTML = ''
  const button = form.querySelector('#generate-btn')
  if (button) button.disabled = true
  const oldBtn = status ? status.querySelector('.retry-btn') : null
  if (oldBtn) oldBtn.remove()
  setStatus('generating', isRetry ? 'Retrying... 🔁' : 'Submitting to OpenRouter... 🚀')
  setState({ isSubmitting: true })

  // Always re-serialize from the form so disabled fields (set by
  // the previous retry's disableFields) are excluded.
  const data = new FormData(form)
  void resendSnapshot // reserved for future "send the exact same bytes" path

  setState({
    lastFailedBody: data,
    lastFailedFields: null,
  })

  try {
    const res = await fetch('/api/generate', { method: 'POST', body: data })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      const fields = Array.isArray(body.unsupportedFields) ? body.unsupportedFields : null
      setState({ lastFailedFields: fields })
      throw body
    }
    setState({ lastFailedBody: null, lastFailedFields: null })

    if (body.kind === 'image') {
      setStatus('done', `Saved: ${body.path}`)
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
    const body = (err && typeof err === 'object' && (err.error || err.code))
      ? err
      : { error: (err && err.message) || String(err), code: 'internal', retryable: false }
    showGenError(body)
  } finally {
    if (button) button.disabled = false
    setState({ isSubmitting: false })
  }
}

export function initSubmit() {
  const form = getForm()
  if (!form) return
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    submitGenerate({ isRetry: false, resendSnapshot: false })
  })
}

// Silence the unused warning on `state` import.
void state
