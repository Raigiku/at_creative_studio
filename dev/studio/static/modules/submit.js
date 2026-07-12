// modules/submit.js
//
// Form submission, retry flow, and the download-bar builder. Owns:
//   - the form's 'submit' listener (installed by initSubmit)
//   - submitGenerate(opts) — the actual POST
//   - showGenError(body)   — render an error in the status bar
//                            with an optional Retry button
//   - disableFields(names) — used by the Retry flow to remove
//                            fields the server rejected
//   - lastFailedRequest / lastFailedFields — memos so Retry can
//                            re-send the same body
//
// Public API:
//
//   initSubmit({ onSubmittingChange }) — wire the submit listener.
//   submitGenerate(opts)               — POST /api/generate.
//   disableFields(names)               — disable+blank named fields
//                                         and refresh dependent UI.
//   lastFailedRequest, lastFailedFields — read-only from outside
//                                         (used by tests / future
//                                         features).

import {
  getForm,
  getPreview,
  getStatus,
} from './dom.js'
import { setStatus, ERROR_ICON } from './status.js'
import {
  refreshKindVisibility,
  refreshResolutionSelect,
  refreshSizeOverride,
} from './kind.js'
import { refreshRefHint } from './references.js'

// Remember the most recent failed request so the "Retry" button can
// resubmit it without the user re-filling the form. Cleared on success.
let lastFailedRequest = null
let lastFailedFields = null   // unsupportedFields from the last error, if any

let _onSubmittingChange = () => {}
let _formEl = null

export function initSubmit({ onSubmittingChange } = {}) {
  _onSubmittingChange = onSubmittingChange || _onSubmittingChange
  _formEl = getForm()
  if (!_formEl) return
  _formEl.addEventListener('submit', (e) => {
    e.preventDefault()
    submitGenerate({ isRetry: false, resendSnapshot: false })
  })
}

// Show an error in the status bar. `opts.retryable` and
// `opts.unsupportedFields` add a button.
function showGenError(body) {
  const status = getStatus()
  if (!status) return
  const icon = ERROR_ICON[body.code] || '❌'
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
    btn.textContent = fields.length > 0 ? '↻ Retry without these fields' : '↻ Retry'
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
export function disableFields(names) {
  const form = getForm()
  if (!form) return
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
    // but the hidden field still has its value — that's fine, FormData
    // includes hidden disabled inputs? It does NOT — disabled inputs are
    // excluded from form submission, same as a select. So we need to clear
    // the hidden aspect_ratio field if the server says aspect_ratio is
    // unsupported.
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
export async function submitGenerate(opts = {}) {
  const { isRetry = false, resendSnapshot = false } = opts
  const form = getForm()
  const preview = getPreview()
  const status = getStatus()
  if (!form) return

  preview.innerHTML = ''
  const button = form.querySelector('#generate-btn')
  if (button) button.disabled = true
  // Clear any previous retry button before showing the new status.
  const oldBtn = status ? status.querySelector('.retry-btn') : null
  if (oldBtn) oldBtn.remove()
  setStatus('generating', isRetry ? 'Retrying... 🔁' : 'Submitting to OpenRouter... 🚀')
  _onSubmittingChange(true)

  // We always re-serialize from the form. Even on a "resend snapshot"
  // retry, the form has been mutated (the offending fields are now
  // disabled), so a fresh FormData is what we want.
  const data = new FormData(form)
  // Always remember the body we're about to send so a future
  // "Retry without these fields" can re-send it after disabling.
  lastFailedRequest = data
  lastFailedFields = null
  // Silence unused warnings on the legacy resendSnapshot flag — it's
  // here for future use (e.g. caching the exact wire bytes for an
  // idempotent retry).
  void resendSnapshot

  try {
    const res = await fetch('/api/generate', { method: 'POST', body: data })
    // Parse body as JSON regardless of status — the server always returns
    // our genError shape on failure.
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      lastFailedFields = Array.isArray(body.unsupportedFields) ? body.unsupportedFields : null
      throw body  // pass the whole body to the catch block
    }
    // Success — clear the failure memo so the form is fully re-serialized
    // on the next submit.
    lastFailedRequest = null
    lastFailedFields = null

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
    // err may be our parsed body object (from `throw body`) or a network
    // error. Normalize to the genError shape.
    const body = (err && typeof err === 'object' && (err.error || err.code))
      ? err
      : { error: (err && err.message) || String(err), code: 'internal', retryable: false }
    showGenError(body)
  } finally {
    if (button) button.disabled = false
    _onSubmittingChange(false)
  }
}
