// helpers.js — small helpers used across components.

// Build a className string from a base + conditional classes.
// `cx(base, { 'class-a': condA, 'class-b': condB }, 'always')` —
// trims whitespace, drops falsy entries.
export function cx(...args) {
  const out = []
  for (const a of args) {
    if (!a) continue
    if (typeof a === 'string') out.push(a)
    else if (typeof a === 'object') {
      for (const k of Object.keys(a)) if (a[k]) out.push(k)
    }
  }
  return out.join(' ')
}
