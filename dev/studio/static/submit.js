// submit.js — owns the status bar.
//
// Handles the form submit, the retry button, and the download
// bar shown after a successful generation. Reads /api/generate,
// parses the response, paints the preview area, and writes the
// only status-bar message the user sees during a request. The
// form's submit listener is wired once via a useEffect in App.js.
//
// All status writes go through setStatus(); no other module
// touches #status. The Generate button's disabled state is
// toggled directly on the DOM (no React state needed for a
// single element).

import { setStatus, ERROR_ICON } from './status.js'

// buildDownloadBar — Drop the "Download ⬇ / Open ↗" bar under a
// generated preview. Pure DOM construction.
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

// showGenError — render an error in the status bar with an optional
// Retry button. If the server included a `raw` field (the upstream
// response body, re-marshalled on the Go side), drop a collapsible
// "Show response" disclosure UNDER the status bar so the bar stays
// a single tidy row. The disclosure is a sibling of #status, not a
// child, so the status's flex layout isn't disturbed.
function showGenError(body) {
  const status = document.getElementById('status')
  if (!status) return
  const icon = ERROR_ICON[body.code] || '❌'
  const retryable = !!body.retryable
  const fields = Array.isArray(body.unsupportedFields) ? body.unsupportedFields : []

  let msg = `${icon} ${body.error || 'Unknown error'}`
  if (fields.length > 0) msg += `\n   Disabling: ${fields.join(', ')}`
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
      if (fields.length > 0) disableFields(fields)
      submitGenerate({ isRetry: true })
    })
    status.appendChild(btn)
  }

  // Drop any prior raw-response disclosure (from a previous error)
  // and, if the server sent us upstream JSON, mount a new one as a
  // sibling of #status. We don't put it inside #status because the
  // status bar is a flex row; a block-level <details> would compete
  // for the same row.
  removeRawResponse()
  if (body.raw != null) {
    const next = status.nextElementSibling
    const raw = buildRawResponse(body.raw)
    if (next && next.id === 'raw-response') {
      next.replaceWith(raw)
    } else {
      status.insertAdjacentElement('afterend', raw)
    }
  }
}

// removeRawResponse — strip any previously-mounted disclosure.
// Called at the start of every submission so a new request doesn't
// show stale JSON from a prior error.
function removeRawResponse() {
  const old = document.getElementById('raw-response')
  if (old) old.remove()
}

// buildRawResponse — wrap the upstream JSON in a <details> block.
// Collapsed by default to keep the status bar scannable. We re-parse
// the body (it round-tripped through Go as a json.RawMessage) and
// pretty-print with 2-space indent so nested fields stay readable.
function buildRawResponse(raw) {
  const wrap = document.createElement('details')
  wrap.className = 'raw-response'
  wrap.id = 'raw-response'
  const summary = document.createElement('summary')
  summary.textContent = 'Show response'
  wrap.appendChild(summary)

  const pre = document.createElement('pre')
  pre.className = 'raw-response-body'
  try {
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
    const parsed = JSON.parse(text)
    pre.textContent = JSON.stringify(parsed, null, 2)
  } catch (_) {
    // Fall back to the raw text. This shouldn't happen because the
    // server only sends a `raw` field when the body parsed as JSON,
    // but defense in depth is cheap here.
    pre.textContent = String(raw)
  }
  wrap.appendChild(pre)
  return wrap
}

// disableFields — used by the retry flow when the server tells us
// the model rejected some params. Disables the named fields in
// the form so the next FormData snapshot omits them, and resets
// the named field to a sane default.
function disableFields(names) {
  const form = document.getElementById('gen-form')
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
      const sz = form.querySelector('[name="size"]')
      if (sz) sz.value = ''
    }
  }
}

export async function submitGenerate({ isRetry = false } = {}) {
  const form = document.getElementById('gen-form')
  const preview = document.getElementById('preview')
  const status = document.getElementById('status')
  if (!form) return

  preview.innerHTML = ''
  const button = document.getElementById('generate-btn')
  if (button) button.disabled = true
  const oldBtn = status ? status.querySelector('.retry-btn') : null
  if (oldBtn) oldBtn.remove()
  removeRawResponse()
  setStatus('generating', isRetry ? 'Retrying... 🔁' : 'Submitting to OpenRouter... 🚀')

  const data = new FormData(form)

  try {
    const res = await fetch('/api/generate', { method: 'POST', body: data })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw body

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
  }
}
