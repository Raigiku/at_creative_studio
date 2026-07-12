// api.js — thin wrapper around /api/models and /api/models/{id}.

export async function fetchModels() {
  const r = await fetch('/api/models')
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching /api/models`)
  return await r.json()
}

export async function fetchCapabilities(modelID) {
  if (!modelID) return null
  const r = await fetch(`/api/models/${encodeURIComponent(modelID)}`)
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching capabilities for ${modelID}`)
  return await r.json()
}
