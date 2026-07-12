// modules/aspect.js
//
// Aspect-ratio UI: the 5 quick-pick pills, the "More…" dropdown that
// holds the rest of the values, and the hidden form field that
// actually gets submitted. Plus the per-model enum apply path that
// marks pills as "not supported" when the model rejects them.
//
// Public API:
//
//   initAspect({ getCurrentKind })       — wire up the pill + More…
//                                          click handlers. getCurrentKind
//                                          is a function returning the
//                                          current "image" | "video"
//                                          kind (so we can read kind
//                                          without importing kind.js
//                                          and creating a cycle).
//   buildAspectRatioOptions(kind)        — repopulate the More… dropdown
//                                          from the static per-kind list.
//   applyAspectEnum(detail)              — repopulate from the model's
//                                          enum and mark unsupported pills.
//   setAspectActive(value)               — set the active pill + sync the
//                                          hidden field + dropdown.
//   getCurrentAspectValues()             — Set<string> of currently
//                                          allowed values (used by
//                                          setAspectActive to refuse
//                                          invalid clicks).
//
// State:
//   ASPECT_RATIOS — the static fallback list, per kind. Sorted at
//                   module load (see top of file).
//   DEFAULT_ASPECT — per-kind default (1:1 for image, 16:9 for video).
//   QUICK_RATIOS  — the 5 pill values.
//
//   currentAspectValues — the set of values the model currently allows.
//                         Filled by applyAspectEnum, consulted by
//                         setAspectActive to refuse invalid clicks.

import { getForm, getAspectHidden, getAspectMore, getRatiosBar } from './dom.js'
import { sortOptions } from './sort.js'

// ---------------------------------------------------------------------------
// Static data. ASPECT_RATIOS is sorted in place at module load so the
// dropdown reads "1:1, 2:3, 3:2, 3:4, 4:3, …" without needing a separate
// rebuild pass. (We use sortOptions() instead of the hand-curated order
// baked into the source list.)
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

// Set of values the model currently accepts. Empty when no model is
// selected (in which case everything in ASPECT_RATIOS is allowed).
let currentAspectValues = new Set()

export function getCurrentAspectValues() {
  return currentAspectValues
}

let _getCurrentKind = () => 'image'

export function initAspect({ getCurrentKind }) {
  _getCurrentKind = getCurrentKind || _getCurrentKind

  const ratiosBar = getRatiosBar()
  for (const pill of ratiosBar.querySelectorAll('.pill')) {
    pill.addEventListener('click', () => {
      // Refuse the click if the pill is blocked for the current model.
      // (The visual ⚠ marker is set by applyAspectEnum via the
      // .cap-auto-adjusted class + data-cap-blocked attribute.) We
      // still want the click handler attached for non-blocked pills.
      if (pill.dataset.capBlocked) {
        // Briefly flash the pill so the user gets feedback that the
        // click was refused.
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
  const aspectMore = getAspectMore()
  aspectMore.addEventListener('change', () => setAspectActive(aspectMore.value))
}

// ---- aspect-ratio pills + "More..." dropdown ----
export function buildAspectRatioOptions(kind) {
  const aspectMore = getAspectMore()
  aspectMore.innerHTML = ''
  // Sort the static aspect-ratio list so the dropdown reads
  // "1:1, 2:3, 3:2, 3:4, …" instead of the hand-curated order in
  // ASPECT_RATIOS. Sentinels like "auto" sink to the bottom.
  const sorted = sortOptions(ASPECT_RATIOS[kind] || [])
  for (const v of sorted) {
    const opt = document.createElement('option')
    opt.value = v
    opt.textContent = v
    aspectMore.appendChild(opt)
  }
  aspectMore.value = ''
  // Hide the "More..." dropdown if it adds nothing beyond the pills.
  const moreWrap = aspectMore.parentElement
  moreWrap.style.display = sorted.some(r => !QUICK_RATIOS.includes(r) && r !== 'auto') ? '' : 'none'
}

export function setAspectActive(value) {
  const aspectHidden = getAspectHidden()
  const aspectMore = getAspectMore()
  const ratiosBar = getRatiosBar()
  const kind = _getCurrentKind()

  // Refuse to set a value the current model doesn't accept. This
  // happens if some other code path (or a stale UI) tries to set an
  // invalid value. We silently no-op rather than throwing because
  // the call sites don't expect a return value.
  if (value && currentAspectValues.size > 0 && !currentAspectValues.has(value)) {
    return
  }
  // Toggle pill states.
  for (const pill of ratiosBar.querySelectorAll('.pill')) {
    pill.classList.toggle('active', pill.dataset.value === value)
  }
  // Sync the hidden form field.
  aspectHidden.value = value || ''
  // If the value isn't on a quick-pick, set the "More..." dropdown to it
  // (and otherwise leave it empty so the dropdown doesn't show a stale value
  // that contradicts the active pill).
  if (value && !QUICK_RATIOS.includes(value) && ASPECT_RATIOS[kind].includes(value)) {
    aspectMore.value = value
  } else {
    aspectMore.value = ''
  }
}

// applyAspectEnum rebuilds the "More…" aspect ratio dropdown from
// the model's enum (or restores the static ASPECT_RATIOS list if no
// model data). The pills are NOT replaced — they're a fixed UX
// affordance — but we mark pills whose value isn't in the model's
// enum as .cap-auto-adjusted so the user sees they're not
// selectable for this model.
export function applyAspectEnum(detail) {
  const aspectMore = getAspectMore()
  const aspectHidden = getAspectHidden()
  const ratiosBar = getRatiosBar()
  const kind = _getCurrentKind()

  // Rebuild the More… dropdown.
  aspectMore.innerHTML = ''
  let values
  if (detail && detail.type === 'enum' && Array.isArray(detail.values) && detail.values.length > 0) {
    values = sortOptions(detail.values)
  } else {
    // No model data: fall back to the static per-kind list, also
    // sorted (the raw list has a hand-curated order that's fine
    // but not numeric; this gives us "1:1, 2:3, 3:2, …" without
    // touching the source data).
    values = sortOptions(ASPECT_RATIOS[kind] || [])
  }
  for (const v of values) {
    const opt = document.createElement('option')
    opt.value = v
    opt.textContent = v
    aspectMore.appendChild(opt)
  }
  // Cache the current allowed set for the pill click handler and
  // setAspectActive to consult.
  currentAspectValues = new Set(values)

  // If the current hidden-field value is no longer in `values`,
  // reset to the default. We don't auto-pick a different value
  // here because the user might be in the middle of editing —
  // refreshCapAdjustNotice is what flashes the warning.
  if (values.length > 0 && !values.includes(aspectHidden.value)) {
    // Try the per-kind default first; if that's also out, pick
    // the first allowed value.
    const fallback = values.includes(DEFAULT_ASPECT[kind])
      ? DEFAULT_ASPECT[kind]
      : values[0]
    aspectHidden.value = fallback
    setAspectActive(fallback)
  }
  // Mark pills that aren't in the model's enum. We use a class
  // for the visual (the .cap-auto-adjusted style adds a yellow
  // border + ⚠) AND set the data-cap-blocked attribute, which the
  // pill click handler consults to refuse the click.
  for (const pill of ratiosBar.querySelectorAll('.pill')) {
    const v = pill.dataset.value
    const supported = values.includes(v)
    pill.classList.toggle('cap-auto-adjusted', !supported)
    if (supported) {
      delete pill.dataset.capBlocked
      pill.removeAttribute('title')
    } else {
      pill.dataset.capBlocked = '1'
      pill.setAttribute('title', `${v} is not supported by this model — pick a different aspect ratio`)
    }
  }
  // Hide the "More…" dropdown if it adds nothing beyond the pills.
  const moreWrap = aspectMore.parentElement
  moreWrap.style.display = values.some(r => !QUICK_RATIOS.includes(r) && r !== 'auto') ? '' : 'none'
}

// Block all pills (used when no model is selected / model capabilities
// are reset). The pill click handler uses this to refuse clicks.
export function unblockAllPills() {
  const ratiosBar = getRatiosBar()
  for (const pill of ratiosBar.querySelectorAll('.pill')) {
    delete pill.dataset.capBlocked
    pill.removeAttribute('title')
    pill.classList.remove('cap-auto-adjusted')
  }
}

export { ASPECT_RATIOS, DEFAULT_ASPECT, QUICK_RATIOS }
