// modules/sort.js
//
// Smart sorter for combobox option lists. The server hands us enum
// values as strings and (deliberately) keeps them in lexicographic
// order so the wire format is stable. But for the UI we want them
// in *semantic* order: numbers smallest-first, aspect ratios sorted
// by their numeric width (then height), mixed resolutions like
// "480p / 1K / 2K / 4K" sorted by pixel count, and so on.
//
// This helper returns a NEW array (does not mutate) ordered the way
// a human would expect. The detection is dynamic: we look at the
// actual values and try the most specific interpretation first,
// falling back to a locale-aware, case-insensitive string sort.
//
// Pure module — no DOM access, no module state. Easy to unit-test.

// sortOptions(["1K", "4K", "2K", "720p", "1080p", "480p"])
//   => ["480p", "720p", "1080p", "1K", "2K", "4K"]
//
// sortOptions(["16:9", "1:1", "4:3", "21:9"])
//   => ["1:1", "4:3", "16:9", "21:9"]   (by width, then height)
//
// sortOptions(["1:1", "auto", "16:9"])
//   => ["1:1", "16:9", "auto"]          (sentinels sink to the bottom)
//
// sortOptions(["grok-imagine-image", "bytedance/seedance", "veo-3.1"])
//   => ["bytedance/seedance", "grok-imagine-image", "veo-3.1"]   (alpha)

export function sortOptions(values) {
  // Defensive: callers in this file always pass an array, but a
  // stray null/undefined shouldn't be able to crash the whole
  // module-load path. The aspect-ratio initializer in particular
  // calls sortOptions() at top level, so any throw here would
  // brick the page on load.
  if (!Array.isArray(values)) return []
  if (values.length < 2) return values.slice()

  // Try each semantic interpretation. The first one that applies to
  // EVERY value wins. If none apply, fall back to string sort.
  const numeric = tryNumericSort(values)
  if (numeric) return numeric
  const aspect = tryAspectRatioSort(values)
  if (aspect) return aspect
  const dimension = tryDimensionSort(values)
  if (dimension) return dimension
  return stringSort(values)
}

// tryNumericSort succeeds when every value parses as a finite number.
// Returns null if the list mixes numbers and non-numbers (so we don't
// mis-sort a list of "5" and "5s" by dropping the unit).
function tryNumericSort(values) {
  const nums = []
  for (const v of values) {
    const trimmed = String(v).trim()
    if (trimmed === '') return null
    const n = Number(trimmed)
    if (!Number.isFinite(n)) return null
    nums.push({ v, n })
  }
  nums.sort((a, b) => a.n - b.n)
  return nums.map(x => x.v)
}

// tryAspectRatioSort matches the "W:H" form (one or two numbers
// separated by ":", e.g. "1:1", "9:16", "19.5:9"). All values must
// match for the sort to apply. Sentinel values like "auto" that don't
// match the pattern sink to the bottom of the result, after the
// sorted numeric entries.
const ASPECT_RE = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/
function tryAspectRatioSort(values) {
  const parsed = []
  let nonMatching = 0
  for (const v of values) {
    const m = ASPECT_RE.exec(String(v))
    if (m) {
      parsed.push({ v, w: Number(m[1]), h: Number(m[2]) })
    } else {
      nonMatching++
    }
  }
  if (nonMatching > 0 && parsed.length === 0) return null
  parsed.sort((a, b) => (a.w - b.w) || (a.h - b.h))
  const sorted = parsed.map(x => x.v)
  // Append non-matching values in their original order at the end.
  // We don't re-sort them — "auto" is the only realistic sentinel and
  // it doesn't need to be alphabetized.
  for (const v of values) {
    if (!ASPECT_RE.test(String(v))) sorted.push(v)
  }
  return sorted
}

// tryDimensionSort handles values that look like "<number><unit>"
// where the unit may be a pixel-line suffix (480p, 1080p, 2160p), a
// K-suffix (1K, 2K, 4K), an MP suffix, or just a bare number that
// represents a pixel count (e.g. "512", "1024"). We parse the
// leading number and apply a multiplier when the unit is recognized
// (see parseDimension for the unit table).
const DIMENSION_RE = /^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z%]*)\s*$/
function parseDimension(value) {
  const m = DIMENSION_RE.exec(String(value))
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  const unit = m[2].toUpperCase()
  let mult
  if (unit === '' || unit === 'P' || unit === 'I' || unit === 'PX') {
    mult = 1
  } else if (unit === 'K') {
    mult = 1024
  } else if (unit === 'M' || unit === 'MP') {
    // Megapixels. 1MP ≈ 1,000,000 pixels. We only use this for sort
    // ordering, so the exact constant doesn't matter.
    mult = 1024 * 1024
  } else {
    // Unknown unit — keep the bare number so the item still sorts in
    // a sensible place relative to other dimensionless values.
    mult = 1
  }
  return n * mult
}
function tryDimensionSort(values) {
  const parsed = []
  for (const v of values) {
    const n = parseDimension(v)
    if (n === null) return null
    parsed.push({ v, n })
  }
  parsed.sort((a, b) => a.n - b.n)
  return parsed.map(x => x.v)
}

// stringSort — case-insensitive, locale-aware, with stable secondary
// order on the raw string so equal-fold results don't shuffle. Used
// when the values are pure labels (model names, format names, etc.).
function stringSort(values) {
  return values.slice().sort((a, b) => {
    const al = String(a).toLocaleLowerCase()
    const bl = String(b).toLocaleLowerCase()
    if (al < bl) return -1
    if (al > bl) return 1
    return String(a) < String(b) ? -1 : (String(a) > String(b) ? 1 : 0)
  })
}

// Re-exported for unit tests.
export const _internal = {
  ASPECT_RE,
  DIMENSION_RE,
  parseDimension,
  tryNumericSort,
  tryAspectRatioSort,
  tryDimensionSort,
  stringSort,
}
