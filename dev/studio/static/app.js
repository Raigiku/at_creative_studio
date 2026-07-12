// app.js — entry point.
//
// Mounts the <App/> component into #root. Also installs a global
// onerror handler that surfaces uncaught errors into the status
// bar so the user sees a useful message even if the script-load
// failed.

import { h, render } from 'preact'
import { App } from './components/App.js'

// Surface uncaught errors to the status bar.
;(function installErrorReporter() {
  function showError(msg) {
    try {
      const status = document.getElementById('status')
      if (status) {
        status.className = 'status status--visible status--error'
        status.textContent = '❌ Script error: ' + msg
      } else {
        const banner = document.createElement('div')
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;padding:12px 16px;background:#ff453a;color:#fff;font:13px/1.4 system-ui,sans-serif;'
        banner.textContent = '❌ Script error: ' + msg
        if (document.body) {
          document.body.prepend(banner)
        } else {
          document.addEventListener('DOMContentLoaded', () => {
            document.body.prepend(banner)
          }, { once: true })
        }
      }
    } catch (_) {
      // Last-ditch: give up silently. The DevTools console still
      // has the original error.
    }
  }
  window.__showScriptError = showError
  window.addEventListener('error', (e) => {
    if (e && e.error && e.error.message) showError(e.error.message)
    else if (e && e.message) showError(e.message)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e && e.reason
    const msg = reason && reason.message ? reason.message : String(reason)
    showError('Unhandled promise rejection: ' + msg)
  })
})()

// Mount the App into #root. The Status component inside <App/>
// renders the #status + #preview elements that submit.js /
// status.js write to.
function mount() {
  const root = document.getElementById('root')
  if (!root) {
    console.error('No #root in DOM')
    return
  }
  render(h(App, null), root)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true })
} else {
  mount()
}
