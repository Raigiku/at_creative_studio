// fieldConfig.js — the per-field "what does this knob do?" tables.
//
// Mirrors the FORM_NAME_TO_CAP_NAME / FORM_FIELD_KIND tables from
// the old vanilla capabilities module. Kept as data so adding a new
// field is a one-line change in two maps.

export const FORM_NAME_TO_CAP_NAME = {
  aspect_ratio:        'aspect_ratio',
  background:          'background',
  output_format:       'output_format',
  quality:             'quality',
  resolution:          'resolution',
  n:                   'n',
  output_compression:  'output_compression',
  seed:                'seed',
  duration:            'duration',
  size:                'size',
  frame_first:         'frame_first',
  frame_last:          'frame_last',
  generate_audio:      'generate_audio',
}

export const FORM_FIELD_KIND = {
  aspect_ratio:        { kind: 'aspect_enum' },
  resolution:          { kind: 'enum_or_range' },
  output_format:       { kind: 'enum' },
  quality:             { kind: 'enum' },
  background:          { kind: 'enum' },
  n:                   { kind: 'range', helpTemplate: '({{min}}–{{max}})' },
  output_compression:  { kind: 'range' },
  duration:            { kind: 'enum', helpTemplate: '(seconds, {{min}}–{{max}})' },
  seed:                { kind: 'range' },
  size:                { kind: 'enum' },
  frame_first:         { kind: 'none' },
  frame_last:          { kind: 'none' },
  generate_audio:      { kind: 'none' },
}

// Attribute used to tag a form element so the clamp-on-model-change
// helper in capabilities.js can find it. Elements without this
// attribute are skipped (so the prompt textarea, file inputs, etc.
// are left alone).
export const CAP_AWARE_ATTR = 'data-cap-name'

// WxH pattern for the "Exact size" field. Mirrors the server-side
// `sizePattern` in dev/studio/params.go.
export const SIZE_PATTERN = /^[1-9][0-9]{1,4}x[1-9][0-9]{1,4}$/

// Hard cap on the number of reference images. The per-model cap
// (e.g. Grok Imagine allows up to 3) replaces this when set.
export const MAX_REFS = 16

// Default aspect ratio per kind.
export const DEFAULT_ASPECT = {
  image: '1:1',
  video: '16:9',
}

// Aspect ratio values we expose as quick-pick pills.
export const QUICK_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:2']

// Full per-kind list, sorted. "auto" sinks to the bottom in the
// aspect sorter so the more common values come first.
export const ASPECT_RATIOS = {
  image: [
    "1:1","1:2","1:4","1:8","2:1","2:3","3:2","3:4","4:1","4:3",
    "4:5","5:4","8:1","9:16","16:9","9:19.5","19.5:9","9:20","20:9","9:21","21:9",
    "auto",
  ],
  video: [
    "16:9","9:16","1:1","4:3","3:4","3:2","2:3","21:9","9:21",
  ],
}
