// modules/dom.js
//
// Shared DOM lookups and the on-page script-error reporter. This is
// the lowest-level module: everything else either imports it or
// re-implements the same patterns. Centralizing the form/status/etc
// element references here means each module just calls getForm()
// instead of running its own document.getElementById at module load.

// ---------------------------------------------------------------------------
// Visible script-load error reporter.
// ---------------------------------------------------------------------------
//
// The app's <script> tag is loaded with the rest of the page. If
// something throws during module load (a temporal-dead-zone error,
// a missing reference, a typo in a top-level statement, etc.),
// execution of this whole file aborts and the page renders half-broken
// with no console of its own to point the user at the problem.
//
// We install a window.onerror handler as the very first thing we do
// — before the consts and before any of the form lookups — so it
// catches errors even from this very file. Any uncaught error or
// unhandled promise rejection is rendered into the status bar
// (or, before the status bar exists, an injected error banner at the
// top of <body>) so the user sees something useful instead of a
// silently-misrendered form.
//
// This is a *defensive* helper. The actual error would still be
// visible in the browser DevTools console; this just makes sure it's
// also visible on the page itself.
;(function installErrorReporter() {
  function showError(msg) {
    try {
      const status = document.getElementById('status')
      if (status) {
        status.className = 'status status--visible status--error'
        status.textContent = '❌ Script error: ' + msg
      } else {
        // Status bar not in the DOM yet (very early load failure).
        // Inject a visible banner at the top of the body so the user
        // sees something.
        const banner = document.createElement('div')
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;padding:12px 16px;background:#ff453a;color:#fff;font:13px/1.4 system-ui,sans-serif;'
        banner.textContent = '❌ Script error: ' + msg
        if (document.body) {
          document.body.prepend(banner)
        } else {
          // Even <body> doesn't exist yet — wait for it.
          document.addEventListener('DOMContentLoaded', () => {
            document.body.prepend(banner)
          }, { once: true })
        }
      }
    } catch (_) {
      // Last-ditch: give up silently. The DevTools console still has
      // the original error.
    }
  }
  window.addEventListener('error', (e) => {
    if (e && e.error && e.error.message) {
      showError(e.error.message)
    } else if (e && e.message) {
      showError(e.message)
    }
  })
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e && e.reason
    const msg = reason && reason.message ? reason.message : String(reason)
    showError('Unhandled promise rejection: ' + msg)
  })
})()

// ---------------------------------------------------------------------------
// Lazy DOM lookups. We look up on first access and cache the result so
// subsequent calls are O(1) and we don't pay the getElementById cost
// at module load time (which is when the error reporter above is
// already running).
// ---------------------------------------------------------------------------
let _form = null
let _status = null
let _preview = null
let _button = null
let _refInput = null
let _refHelp = null
let _refPreview = null
let _aspectHidden = null
let _aspectMore = null
let _ratiosBar = null
let _capHint = null
let _sizeInput = null

export function getForm() {
  if (!_form) _form = document.getElementById('gen-form')
  return _form
}
export function getStatus() {
  if (!_status) _status = document.getElementById('status')
  return _status
}
export function getPreview() {
  if (!_preview) _preview = document.getElementById('preview')
  return _preview
}
export function getButton() {
  if (!_button) _button = document.getElementById('generate-btn')
  return _button
}
export function getRefInput() {
  if (!_refInput) _refInput = document.getElementById('ref')
  return _refInput
}
export function getRefHelp() {
  if (!_refHelp) _refHelp = document.getElementById('ref-help')
  return _refHelp
}
export function getRefPreview() {
  if (!_refPreview) _refPreview = document.getElementById('ref-preview')
  return _refPreview
}
export function getAspectHidden() {
  if (!_aspectHidden) _aspectHidden = document.getElementById('aspect_ratio')
  return _aspectHidden
}
export function getAspectMore() {
  if (!_aspectMore) _aspectMore = document.getElementById('aspect_ratio_select')
  return _aspectMore
}
export function getRatiosBar() {
  if (!_ratiosBar) _ratiosBar = document.getElementById('ratios')
  return _ratiosBar
}
export function getCapHint() {
  if (!_capHint) _capHint = document.getElementById('cap-hint')
  return _capHint
}
export function getSizeInput() {
  if (!_sizeInput) _sizeInput = document.getElementById('size_vid')
  return _sizeInput
}
