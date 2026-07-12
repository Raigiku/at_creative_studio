// status.js — tiny wrapper around the status bar element. The
// status bar is the one place the form gives feedback ("Generating...",
// "Saved: ...", "❌ Too many reference images", etc.), so almost
// every module ends up writing to it. This module centralizes the
// formatting so the call sites stay clean and the styling stays
// consistent.

export function setStatus(state, message) {
  const status = document.getElementById('status')
  if (!status) return
  status.className = `status status--visible status--${state}`
  status.textContent = message
}

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
