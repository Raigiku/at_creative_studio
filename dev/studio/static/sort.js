// sort.js — smart sorter for combobox option lists.
// (Carried over from the vanilla version; pure helper, no Preact deps.)
//
// sortOptions(["1K", "4K", "2K", "720p", "1080p", "480p"])
//   => ["480p", "720p", "1080p", "1K", "2K", "4K"]
// sortOptions(["16:9", "1:1", "4:3", "21:9"])
//   => ["1:1", "4:3", "16:9", "21:9"]
// sortOptions(["grok-imagine-image", "bytedance/seedance", "veo-3.1"])
//   => ["bytedance/seedance", "grok-imagine-image", "veo-3.1"]

export function sortOptions(values) {
  if (!Array.isArray(values)) return []
  if (values.length < 2) return values.slice()
  const numeric = tryNumericSort(values)
  if (numeric) return numeric
  const aspect = tryAspectRatioSort(values)
  if (aspect) return aspect
  const dimension = tryDimensionSort(values)
  if (dimension) return dimension
  return stringSort(values)
}

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

const ASPECT_RE = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/
function tryAspectRatioSort(values) {
  const parsed = []
  let nonMatching = 0
  for (const v of values) {
    const m = ASPECT_RE.exec(String(v))
    if (m) parsed.push({ v, w: Number(m[1]), h: Number(m[2]) })
    else nonMatching++
  }
  if (nonMatching > 0 && parsed.length === 0) return null
  parsed.sort((a, b) => (a.w - b.w) || (a.h - b.h))
  const sorted = parsed.map(x => x.v)
  for (const v of values) if (!ASPECT_RE.test(String(v))) sorted.push(v)
  return sorted
}

const DIMENSION_RE = /^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z%]*)\s*$/
function parseDimension(value) {
  const m = DIMENSION_RE.exec(String(value))
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  const unit = m[2].toUpperCase()
  let mult
  if (unit === '' || unit === 'P' || unit === 'I' || unit === 'PX') mult = 1
  else if (unit === 'K') mult = 1024
  else if (unit === 'M' || unit === 'MP') mult = 1024 * 1024
  else mult = 1
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

function stringSort(values) {
  return values.slice().sort((a, b) => {
    const al = String(a).toLocaleLowerCase()
    const bl = String(b).toLocaleLowerCase()
    if (al < bl) return -1
    if (al > bl) return 1
    return String(a) < String(b) ? -1 : (String(a) > String(b) ? 1 : 0)
  })
}
