// app.js — orchestrator.
//
// With the central state architecture, the orchestrator is just:
//   1. init each module (wires event handlers, registers render subs)
//   2. bootstrap (fetch /api/models, apply the initial model)
//
// Every cross-module interaction is now a single setState() call. There
// is no callback fan-out, no `refreshAll()` chain to keep in sync, and
// no chance of "I forgot to re-render X after Y changed" because the
// subscriber registry covers every DOM write.

import { getForm } from './modules/dom.js'
import { setStatus } from './modules/status.js'
import { setKind, currentType } from './modules/kind.js'
import { initAspect, DEFAULT_ASPECT } from './modules/aspect.js'
import { initReferences } from './modules/references.js'
import { initFrames } from './modules/frames.js'
import { initSubmit } from './modules/submit.js'
import { initCapabilities, bootstrapCapabilities } from './modules/capabilities.js'
import { setState } from './modules/state.js'

// Initialize each module. Each init() wires event handlers and
// registers a render subscriber. There are no cross-module callbacks.
initAspect()
initKind()
initReferences()
initFrames()
initSubmit()
initCapabilities()

// Bootstrap. The kind defaults from the HTML <input type="radio"
// (image is checked by default). We seed state.kind from that, set
// the per-kind aspect default, then fetch /api/models and apply
// the first model's capabilities.
setState({ kind: currentType() })
setState({ aspectActive: DEFAULT_ASPECT[currentType()] || '1:1' })

;(async function bootstrap() {
  try {
    await bootstrapCapabilities()
  } catch (err) {
    setStatus('error', `Failed to initialize: ${err.message}`)
  }
})()

// Suppress unused warning on getForm.
void getForm
