// modules/status.js
//
// Tiny wrapper around the status bar element. The status bar is the
// one place in the form where the user gets feedback ("Generating...",
// "Saved: ...", "❌ Too many reference images", etc.), so almost
// every module ends up writing to it. This module centralizes the
// formatting so the call sites stay clean and the styling stays
// consistent.

import { getStatus } from './dom.js'

export function setStatus(state, message) {
  const status = getStatus()
  if (!status) return
  status.className = `status status--visible status--${state}`
  status.textContent = message
}

// Map server `code` values to a short emoji prefix. Kept here so
// submit.js doesn't have to know the full set; it just passes the
// error body to showGenError() and we resolve the icon.
export const ERROR_ICON = {
  auth: '🔑',
  quota: '💸',
  rate_limit: '⏳',
  unsupported_fields: '🚫',
  bad_request: '⚠️',
  moderation: '🛑',
  upstream: '☁️',
  network: '🌐',
  video_failed: '🎬',
  internal: '❌',
}
