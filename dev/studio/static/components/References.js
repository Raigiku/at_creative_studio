// components/References.js — reference image picker + preview grid.
//
// Multi-file <input> + per-thumb grid showing each picked image
// with an "index pill", a remove button, and a selectable filename
// strip. Reference images are visual guides only — frame anchors
// (first/last frame) live in the dedicated Frames component.
//
// The picked file list lives in local useState (re-renders drive
// the preview URLs). The over-cap warning is rendered locally
// in the help span — it does not touch the status bar, which
// is submit.js's exclusive concern.

import { h } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import htm from 'htm'
import { useStudio } from '../state.js'
import { MAX_REFS } from '../fieldConfig.js'
import { deriveView } from '../capabilities.js'

const html = htm.bind(h)

// A single reference thumbnail. Defined as a top-level component
// (not inline) so htm doesn't have to deal with multi-child
// returns nested inside another template.
function RefThumb({ file, index, onRemove }) {
  if (!file) return null
  // Memoize the object URL per file. The cleanup runs only when
  // `file` changes or the component unmounts — not on every render.
  const url = useMemo(() => URL.createObjectURL(file), [file])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return html`
    <div class="ref-thumb">
      <div class="ref-img">
        <img src=${url} alt=${file.name || `Reference ${index + 1}`} loading="lazy" />
        <span class="idx">#${index + 1}</span>
        <button
          type="button"
          class="remove"
          aria-label=${`Remove ${file.name || 'reference ' + (index + 1)}`}
          onClick=${(ev) => { ev.preventDefault(); onRemove(index) }}
        >✕</button>
      </div>
      <span class="name" title=${file.name || ''}>${file.name || `Reference ${index + 1}`}</span>
    </div>
  `
}

// Pure preview grid. Renders an empty hidden div when no files are
// picked (so the .ref-preview CSS selector still has something to
// hook into).
function RefPreview({ files, count, onRemove }) {
  if (count === 0) {
    return html`<div id="ref-preview" class="ref-preview" hidden=${true}></div>`
  }
  return html`
    <div id="ref-preview" class="ref-preview" hidden=${false}>
      ${Array.from({ length: count }).map((_, i) => html`
        <${RefThumb}
          key=${i}
          file=${files[i]}
          index=${i}
          onRemove=${onRemove}
        />
      `)}
    </div>
  `
}

export function References() {
  const { state } = useStudio()
  const [files, setFiles] = useState([])
  const inputRef = useRef(null)

  const view = deriveView(state.capabilities)
  const refMax = (view && view._refMax) || MAX_REFS
  const count = files.length
  const kind = state.kind
  const overCap = count > refMax
  const perModelNote = refMax !== MAX_REFS
    ? ` (this model allows up to ${refMax})`
    : ''

  // Hint text. The over-cap warning lives here, in the help
  // span — it does not touch the status bar.
  const modeLabel = kind === 'image' ? 'image-to-image' : 'image-to-video'
  let hintText
  if (count === 0) {
    hintText = `(optional — up to ${refMax}${perModelNote}, turns it into ${modeLabel})`
  } else {
    const suffix = overCap ? '⚠️ over cap' : `will run as ${modeLabel} ✨`
    hintText = `(${count}/${refMax} selected — ${suffix})${perModelNote}`
  }

  function onPick(e) {
    const list = e.currentTarget.files
    setFiles(list ? Array.from(list) : [])
  }

  // Remove one file. We rebuild the input's FileList from the
  // remaining array so the next pick also has the right baseline
  // (browsers don't natively let you remove items from a FileList).
  function removeAt(i) {
    const input = inputRef.current
    if (!input) return
    const next = files.filter((_, j) => j !== i)
    if (input.files && typeof DataTransfer !== 'undefined') {
      const dt = new DataTransfer()
      for (const f of next) dt.items.add(f)
      input.files = dt.files
    } else {
      // Fallback: clear the input. The user will need to re-pick
      // to add more refs, but the existing previews still render.
      input.value = ''
    }
    setFiles(next)
  }

  // Clear all picked references. Resets the file <input> so the
  // next pick starts from a clean baseline (browsers don't fire
  // `change` when you re-pick the same file, so just emptying
  // the array isn't enough).
  function clearAll() {
    const input = inputRef.current
    if (input) input.value = ''
    setFiles([])
  }

  return html`
    <div class="section">
      <label class="section-label" for="ref">
        🖼️ Reference images
        <span
          class="help"
          id="ref-help"
          style=${overCap ? 'color: var(--red)' : ''}
        >${hintText}</span>
        ${count > 0 && html`
          <button
            type="button"
            class="clear-all-btn"
            onClick=${clearAll}
            title="Remove all reference images"
          >Clear all</button>
        `}
      </label>
      <input
        type="file"
        ref=${inputRef}
        id="ref"
        name="ref"
        accept="image/*"
        multiple
        onChange=${onPick}
      />
      <${RefPreview}
        files=${files}
        count=${count}
        onRemove=${removeAt}
      />
    </div>
  `
}
