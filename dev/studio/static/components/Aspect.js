// components/Aspect.js — aspect-ratio pills + "More…" dropdown.
//
// Five quick-pick pills + a More… <select> for everything else.
// Reads the per-model allowlist from state.capabilities; falls
// back to the static per-kind list.
//
// Pill behavior:
//   - Click a pill to set the value (unless the model doesn't
//     support it, in which case the pill shakes).
//   - Pick from the More… dropdown to set the value to anything
//     in the model's allowlist.
//   - If the active value is no longer supported by the newly-
//     selected model, fall back to the per-kind default. This
//     auto-adjust lives in a useEffect so we don't mutate state
//     during render.

import { h } from 'preact'
import { useEffect } from 'preact/hooks'
import htm from 'htm'
import { useStudio } from '../state.js'
import { sortOptions } from '../sort.js'
import { ASPECT_RATIOS, DEFAULT_ASPECT, QUICK_RATIOS } from '../fieldConfig.js'
import { cx } from '../helpers.js'

const html = htm.bind(h)

// Compute the value-set for the More… dropdown given the current
// kind and the per-model capabilities (if any).
//
// The server sends `state.capabilities` shaped as
// { fields: { aspect_ratio: { type, values, ... } } } when the
// model has a capabilities block in models.yaml. When the
// capabilities is null (model has no block) we fall back to the
// per-kind static list.
function valuesForKind(state) {
  const fieldCap = state.capabilities
    && state.capabilities.fields
    && state.capabilities.fields.aspect_ratio
  if (fieldCap && fieldCap.type === 'enum' && Array.isArray(fieldCap.values) && fieldCap.values.length > 0) {
    return sortOptions(fieldCap.values)
  }
  return sortOptions(ASPECT_RATIOS[state.kind] || [])
}

export function Aspect() {
  const { state, setState } = useStudio()
  const values = valuesForKind(state)
  // The "More…" dropdown shows values that aren't already a quick
  // pill. `auto` is included — the user may want to let the model
  // pick the aspect ratio.
  const moreValues = values.filter(v => !QUICK_RATIOS.includes(v))
  const showMore = moreValues.length > 0
  const active = state.aspectActive
  const moreValue = active && !QUICK_RATIOS.includes(active) ? active : ''

  // Auto-adjust: if the active value isn't in the allowlist, fall
  // back to the per-kind default (or the first available). Runs in
  // an effect so we don't write state during render.
  useEffect(() => {
    if (!active || values.includes(active)) return
    const next = values.includes(DEFAULT_ASPECT[state.kind])
      ? DEFAULT_ASPECT[state.kind]
      : (values[0] || '')
    if (next && next !== active) setState({ aspectActive: next })
  }, [active, values, state.kind])

  return html`
    <div class="section">
      <span class="section-label">📐 Aspect ratio</span>
      <div class="grid">
        <div class="field field-full">
          <div class="ratios" id="ratios">
            ${QUICK_RATIOS.map(v => {
              const supported = values.includes(v)
              const cls = cx('pill', { 'active': v === active, 'cap-auto-adjusted': !supported })
              const title = supported ? undefined : `${v} is not supported by this model — pick a different aspect ratio`
              return html`
                <span
                  key=${v}
                  class=${cls}
                  data-value=${v}
                  title=${title}
                  onClick=${(e) => {
                    if (!supported) {
                      // Shake animation
                      e.currentTarget.animate(
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
                    setState({ aspectActive: v })
                  }}
                >${v}</span>
              `
            })}
            ${showMore && html`
              <span class="more">
                <span class="more-label">More… 🔽</span>
                <select
                  id="aspect_ratio_select"
                  aria-label="Other aspect ratios"
                  value=${moreValue}
                  onChange=${(e) => setState({ aspectActive: e.currentTarget.value })}
                >
                  ${moreValues.map(v => html`
                    <option key=${v} value=${v}>${v}</option>
                  `)}
                </select>
              </span>
            `}
          </div>
          <input type="hidden" id="aspect_ratio" name="aspect_ratio" value=${active || ''} />
        </div>
      </div>
    </div>
  `
}
