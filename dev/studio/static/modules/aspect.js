// modules/aspect.js
//
// Aspect-ratio UI: the 5 quick-pick pills, the "More…" dropdown, and
// the hidden form field. State-driven: the only mutator is
// setAspectActive(), which updates state.aspectActive. The render
// function is registered via subscribe() so it runs every time the
// state changes (including kind switches and capabilities loads).
//
// Public API:
//
//   initAspect()                — wire the pill + More… click handlers.
//   applyAspectEnum(detail)     — kept for backwards-compat with the
//                                 capabilities module; delegates to
//                                 setState({ capabilities }).
//   setAspectActive(value)      — user-facing setter.
//
// Static data (per-kind default + quick picks + sort key) stays at
// the top of the file as a constant.

import { getForm, getAspectHidden, getAspectMore, getRatiosBar } from './dom.js'
import { sortOptions } from './sort.js'
import { state, subscribe, setState } from './state.js'

// ---------------------------------------------------------------------------
// Static data. ASPECT_RATIOS is sorted in place at module load so the
// dropdown reads "1:1, 2:3, 3:2, 3:4, 4:3, …" without needing a separate
// rebuild pass.
// ---------------------------------------------------------------------------
const ASPECT_RATIOS = {
  image: sortOptions([
    "1:1","1:2","1:4","1:8","2:1","2:3","3:2","3:4","4:1","4:3",
    "4:5","5:4","8:1","9:16","16:9","9:19.5","19.5:9","9:20","20:9","9:21","21:9",
    "auto",
  ]),
  video: sortOptions([
    "16:9","9:16","1:1","4:3","3:4","3:2","2:3","21:9","9:21",
  ]),
}

const DEFAULT_ASPECT = {
  image: '1:1',
  video: '16:9',
}

const QUICK_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:2"]

// Module-level cache: the set of values the current model accepts.
// Cleared when capabilities is null (no model = everything allowed).
let currentAspectValues = new Set()

// getValuesForKind — returns the values to show in the More… dropdown
// for the given kind. If the current model has an aspect_ratio enum,
// use that (sorted); otherwise fall back to the static per-kind list.
function getValuesForKind(kind) {
  const detail = state.capabilities && state.capabilities.param_details
    && state.capabilities.param_details.aspect_ratio
  if (detail && detail.type === 'enum' && Array.isArray(detail.values) && detail.values.length > 0) {
    return sortOptions(detail.values)
  }
  return sortOptions(ASPECT_RATIOS[kind] || [])
}

// renderAspect — runs on every state change. Idempotent.
function renderAspect() {
  const kind = state.kind
  const aspectHidden = getAspectHidden()
  const aspectMore = getAspectMore()
  const ratiosBar = getRatiosBar()
  const values = getValuesForKind(kind)
  currentAspectValues = new Set(values)

  // 1. Rebuild the More… dropdown.
  aspectMore.innerHTML = ''
  for (const v of values) {
    const opt = document.createElement('option')
    opt.value = v
    opt.textContent = v
    aspectMore.appendChild(opt)
  }
  const moreWrap = aspectMore.parentElement
  moreWrap.style.display = values.some(r => !QUICK_RATIOS.includes(r) && r !== 'auto') ? '' : 'none'

  // 2. If the active value is no longer allowed, fall back to default.
  let active = state.aspectActive
  if (active && !values.includes(active)) {
    active = values.includes(DEFAULT_ASPECT[kind]) ? DEFAULT_ASPECT[kind] : (values[0] || '')
    // Mutate state directly (no setState, no re-render loop).
    state.aspectActive = active
  }

  // 3. Sync the hidden field, pills, and More… display.
  aspectHidden.value = active || ''
  for (const pill of ratiosBar.querySelectorAll('.pill')) {
    const v = pill.dataset.value
    const supported = values.includes(v)
    pill.classList.toggle('active', v === active)
    pill.classList.toggle('cap-auto-adjusted', !supported)
    if (supported) {
      delete pill.dataset.capBlocked
      pill.removeAttribute('title')
    } else {
      pill.dataset.capBlocked = '1'
      pill.setAttribute('title', `${v} is not supported by this model — pick a different aspect ratio`)
    }
  }
  if (active && !QUICK_RATIOS.includes(active)) {
    aspectMore.value = active
  } else {
    aspectMore.value = ''
  }
}

export function initAspect() {
  const ratiosBar = getRatiosBar()
  const form = getForm()
  const aspectMore = getAspectMore()

  for (const pill of ratiosBar.querySelectorAll('.pill')) {
    pill.addEventListener('click', () => {
      if (pill.dataset.capBlocked) {
        pill.animate(
          [
            { transform: 'translateX(0)' },
            { transform: 'translateX(-3px)' },
            { transform: 'translateX(3px)' },
            { transform: 'translateX(0)' },
          ],
          { duration: 120 }
        )
        return
      }
      setAspectActive(pill.dataset.value)
    })
  }
  aspectMore.addEventListener('change', () => setAspectActive(aspectMore.value))

  // Set the kind's default on init so the More… dropdown isn't empty
  // before the first state change.
  state.aspectActive = DEFAULT_ASPECT[form.type.value] || '1:1'
  subscribe(renderAspect)
}

export function setAspectActive(value) {
  if (value && currentAspectValues.size > 0 && !currentAspectValues.has(value)) {
    return
  }
  setState({ aspectActive: value || '' })
}

// applyAspectEnum — kept for backwards-compat with the capabilities
// module. The capabilities module calls this to force a re-render
// after it has updated state.capabilities. With the new state
// architecture this is just a re-render of the aspect slice.
export function applyAspectEnum(_detail) {
  renderAspect()
}

export { ASPECT_RATIOS, DEFAULT_ASPECT, QUICK_RATIOS }
