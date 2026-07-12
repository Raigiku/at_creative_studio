// app.js — orchestrator.
//
// This file used to be a 1500-line single-file app. After the module
// split, it's a thin shell that imports each feature module, wires
// the cross-module callbacks, and runs the on-load bootstrap.
//
// Each module is responsible for one concern. Cross-module state is
// passed via callbacks (declared at the top of each module's init
// function's parameter list) so we don't get hidden import cycles.
//
// On-load order:
//   1. References     — needed by Capabilities (which calls refreshRefHint).
//   2. Aspect         — needed by Capabilities (which calls applyAspectEnum).
//   3. Kind           — needed by References, Capabilities, Submit.
//   4. Frames         — independent.
//   5. Submit         — installs the form submit listener.
//   6. Capabilities   — installs the model-select listener.
//   7. Bootstrap      — fetch /api/models, populate the dropdown, then
//                       trigger applyCapabilitiesForModel for the
//                       initially-selected model.

import { getForm } from './modules/dom.js'
import { setStatus } from './modules/status.js'

import {
  initAspect,
  buildAspectRatioOptions,
  setAspectActive,
  DEFAULT_ASPECT,
} from './modules/aspect.js'

import {
  initKind,
  currentType,
  refreshKindVisibility,
  refreshResolutionSelect,
  refreshSizeOverride,
} from './modules/kind.js'

import {
  initReferences,
  refreshRefHint,
  renderRefPreview,
} from './modules/references.js'

import { initFrames } from './modules/frames.js'

import {
  initSubmit,
} from './modules/submit.js'

import {
  initCapabilities,
  refreshModelOptions,
  applyCapabilitiesForModel,
  applyCapabilitiesFromData,
  setModels,
} from './modules/capabilities.js'

// ---------------------------------------------------------------------------
// Cross-module callbacks. Each module takes an `onKindChanged`,
// `onChange`, `onApplied`, etc. callback so it can notify the
// orchestrator (or another module) without creating an import cycle.
// ---------------------------------------------------------------------------

// On every kind change we need to:
//   - rebuild the aspect ratio dropdown for the new kind
//   - reset the active aspect pill to the per-kind default
//   - repopulate the model dropdown for the new kind
//   - re-run kind visibility (show/hide image-vs-video sections)
//   - re-enable the right resolution select
//   - re-run the size-override logic
//   - re-render reference previews (so role badges switch to "First/Last frame")
//   - re-apply cached capabilities (so the cap re-asserts for video refs)
function onKindChanged() {
  const kind = currentType()
  buildAspectRatioOptions(kind)
  setAspectActive(DEFAULT_ASPECT[kind] || '')
  refreshModelOptions()
  refreshKindVisibility()
  refreshResolutionSelect()
  refreshSizeOverride()
  // Re-render reference previews so the role badges reflect the new kind.
  // (First frame / Last frame are only meaningful in video mode.)
  const refInput = getForm().querySelector('input[name="ref"]')
  if (refInput && refInput.files && refInput.files.length > 0) {
    renderRefPreview()
  }
  refreshRefHint()
  // Re-apply the cached capabilities for the currently-selected model.
  // We deliberately do NOT re-fetch — the model's supported_params
  // don't depend on whether the user is generating an image or a
  // video. If the cache is cold (first switch after page load, before
  // the initial fetch resolved), the apply is a no-op and the
  // initial applyCapabilitiesForModel call from the on-load IIFE will
  // populate the form when the response arrives.
  const mid = getForm().model.value
  if (mid) {
    applyCapabilitiesForModel(mid)
  } else {
    applyCapabilitiesFromData(null)
  }
}

// On capabilities applied, refresh dependent UI.
function onCapabilitiesApplied() {
  // The capabilities module already calls refreshKindVisibility,
  // refreshResolutionSelect, refreshRefHint, and (via applyAspectEnum)
  // rebuilds the aspect dropdown. Nothing else to do here.
}

// ---------------------------------------------------------------------------
// Init each module.
// ---------------------------------------------------------------------------
initAspect({ getCurrentKind: currentType })
initKind({ onKindChanged })
initReferences({ onChange: () => {} })
initFrames()
initSubmit({})
initCapabilities({ onApplied: onCapabilitiesApplied })

// ---------------------------------------------------------------------------
// On-load bootstrap. Fetch the model list, populate the dropdown, then
// trigger the per-model capabilities fetch for the initially-selected
// model.
// ---------------------------------------------------------------------------
;(async function bootstrap() {
  try {
    const m = await fetch('/api/models').then(r => r.json())
    setModels(m)
    refreshModelOptions()
    setAspectActive(DEFAULT_ASPECT[currentType()] || '1:1') // ensure default state
    // Now that the model dropdown has its initial value, ask the
    // server what that model supports and dim unsupported fields.
    applyCapabilitiesForModel(getForm().model.value)
  } catch (err) {
    setStatus('error', `Failed to initialize: ${err.message}`)
  }
})()
