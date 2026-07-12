// state.js — studio form state.
//
// State lives in <App> via useState. This module exposes:
//
//   STUDIO_INITIAL_STATE  — the initial shape of the shared state.
//   StudioContext         — Context that carries { state, setState }.
//   useStudio()           — consumer hook. Returns {} if used outside
//                           the Provider; call sites fail obviously
//                           when they read a missing field.
//
// State is intentionally minimal: only the values that more than one
// component reads. Form-field values, file lists, and submission
// state live in their own components or in the DOM.

import { createContext } from 'preact'
import { useContext } from 'preact/hooks'

export const STUDIO_INITIAL_STATE = {
  kind: 'image',
  modelID: '',
  models: { image: [], video: [] },
  capabilities: null,
  aspectActive: '1:1',
}

export const StudioContext = createContext(null)

export function useStudio() {
  return useContext(StudioContext) || {}
}
