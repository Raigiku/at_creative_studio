// components/ImageOptions.js — image-only output options.
//
// Format, quality, background, resolution, number-of-images,
// compression. All fields are rendered through the shared
// CapSelect / CapNumberInput helpers from capFields.js so the
// dropdown options and the number-input min/max reflect the
// active model's capabilities. Fields the model doesn't support
// are dimmed and disabled.

import { h } from 'preact'
import htm from 'htm'
import { useStudio } from '../state.js'
import { deriveView } from '../capabilities.js'
import { CapSelect, CapNumberInput, FIELD_FALLBACKS } from './capFields.js'

const html = htm.bind(h)

export function ImageOptions() {
  const { state } = useStudio()
  if (state.kind !== 'image') return null
  const view = deriveView(state.capabilities)
  return html`
    <div class="section">
      <span class="section-label">🖼️ Image options</span>
      <div class="grid">
        <${CapSelect}
          name="output_format"
          label="📄 Format"
          fallback=${FIELD_FALLBACKS.output_format}
          view=${view}
        />
        <${CapSelect}
          name="quality"
          label="✨ Quality"
          fallback=${FIELD_FALLBACKS.quality}
          view=${view}
        />
        <${CapSelect}
          name="background"
          label="🎨 Background"
          fallback=${FIELD_FALLBACKS.background}
          view=${view}
        />
        <${CapSelect}
          name="resolution"
          label="📐 Resolution"
          fallback=${FIELD_FALLBACKS.resolution}
          view=${view}
        />
        <${CapNumberInput}
          name="n"
          label="🔢 Number of images"
          help="(1–10)"
          min="1"
          max="10"
          value="1"
          view=${view}
        />
        <${CapNumberInput}
          name="output_compression"
          label="🗜️ Compression"
          help="(0–100, JPEG/WebP)"
          min="0"
          max="100"
          value="100"
          view=${view}
        />
      </div>
    </div>
  `
}
