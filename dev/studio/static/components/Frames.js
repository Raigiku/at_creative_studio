// components/Frames.js — first/last frame anchor inputs (video only).
//
// Two single-image file inputs with preview thumbnails. Each slot
// owns its own local useState for the picked file (re-renders
// drive the preview URL). When the active model no longer
// supports a given anchor, the slot's useEffect drops the file
// and resets the input so the next pick is clean — this is local
// to the component that owns the file; App.js doesn't need to
// know about frame state.

import { h } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import htm from 'htm'
import { useStudio } from '../state.js'
import { deriveView } from '../capabilities.js'
import { cx } from '../helpers.js'

const html = htm.bind(h)

// One frame slot (first OR last). Cap-aware: when the model only
// advertises `first_frame` (and not `last_frame`) in its
// supported_frame_images, the Last frame slot dims+disables so
// the user can't pick a file the server would reject.
function FrameSlot({ slot }) {
  const { state } = useStudio()
  const capName = slot === 'first' ? 'frame_first' : 'frame_last'
  const [file, setFile] = useState(null)
  const inputId = capName
  const previewId = slot === 'first' ? 'frame_first_preview' : 'frame_last_preview'
  const label = slot === 'first' ? '🎞️ First frame' : '🎞️ Last frame'
  const inputRef = useRef(null)

  const view = deriveView(state.capabilities)
  const isSupported = !view || !view[capName] || view[capName].supported

  // When the model no longer supports this anchor, drop the file
  // and reset the <input>'s value so the next pick is clean.
  // The view's `supported` boolean is false for fields not in
  // supported_params; when state.capabilities is null, the field
  // is treated as supported (fallback).
  useEffect(() => {
    if (isSupported || !file) return
    setFile(null)
    if (inputRef.current) inputRef.current.value = ''
  }, [isSupported, file])

  function onPick(e) {
    setFile((e.currentTarget.files && e.currentTarget.files[0]) || null)
  }

  function onRemove(ev) {
    ev.preventDefault()
    if (inputRef.current) inputRef.current.value = ''
    setFile(null)
  }

  return html`
    <div class=${cx('field', { 'cap-unsupported': !isSupported })} data-cap-name=${capName}>
      <label class="section-label" for=${inputId}>
        ${label} <span class="help">(optional, single image)</span>
      </label>
      <input
        type="file"
        ref=${inputRef}
        id=${inputId}
        name=${inputId}
        data-cap-name=${capName}
        accept="image/*"
        onChange=${onPick}
        disabled=${!isSupported}
      />
      <${FramePreview}
        slot=${slot}
        previewId=${previewId}
        file=${file}
        onRemove=${onRemove}
      />
    </div>
  `
}

// Pure preview tile for one frame slot. Returns null when no file
// is selected (so the slot is hidden cleanly).
function FramePreview({ slot, previewId, file, onRemove }) {
  if (!file) return null
  // Memoize the object URL per file. The cleanup only runs when
  // `file` changes or the component unmounts — not on every render.
  const url = useMemo(() => URL.createObjectURL(file), [file])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return html`
    <div id=${previewId} class="frame-preview" hidden=${false}>
      <img src=${url} alt=${file.name || `Frame ${slot}`} />
      <span class="label">${slot === 'first' ? 'First frame' : 'Last frame'}</span>
      <span class="name" title=${file.name || ''}>${file.name || ''}</span>
      <button
        type="button"
        class="remove"
        aria-label=${`Remove ${file.name || 'frame'}`}
        onClick=${onRemove}
      >×</button>
    </div>
  `
}

export function Frames() {
  // First/last frame slots sit side-by-side (flex row, equal
  // width). Spans both columns of VideoOptions' outer .grid so
  // each slot gets a comfortable share of the form width.
  return html`
    <div class="frames-row field-full">
      <${FrameSlot} slot="first" />
      <${FrameSlot} slot="last" />
    </div>
  `
}
