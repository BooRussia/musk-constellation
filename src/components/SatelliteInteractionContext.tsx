import { useEffect, useState } from 'react'
import type { SatelliteHit } from './SatelliteCloud'

// ============================================
// Satellite hover/click event bus
// ============================================
// SatelliteCloud is mounted inside EarthScene's <Canvas>, which we
// can't modify (owned by other agents). So we can't pass hover/click
// callbacks — or the inverse "highlighted norad id" — as React props
// through EarthScene. React context across the r3f Canvas boundary
// can be flaky depending on the bridge setup, so we use a tiny
// module-level pub/sub instead — zero risk of stale-tree gotchas,
// trivial to reason about, fires synchronously.
//
// There is only ever ONE SatelliteCloud and ONE host view active at
// a time (the Starlink view), so a singleton emitter is exactly the
// right granularity.

type HoverListener = (hit: SatelliteHit | null) => void
type SelectListener = (hit: SatelliteHit | null) => void
type HighlightListener = (noradId: number | null) => void

const hoverListeners = new Set<HoverListener>()
const selectListeners = new Set<SelectListener>()
const highlightListeners = new Set<HighlightListener>()

// Last-known highlighted norad id. Sticks around between mounts so
// SatelliteCloud picks up the value the moment it subscribes.
let highlightedNoradId: number | null = null

/** Called by SatelliteCloud when the cursor moves over (or off) a sat. */
export function emitSatelliteHover(hit: SatelliteHit | null): void {
  for (const fn of hoverListeners) fn(hit)
}

/** Called by SatelliteCloud when the user clicks a sat (or empty space). */
export function emitSatelliteSelect(hit: SatelliteHit | null): void {
  for (const fn of selectListeners) fn(hit)
}

/** Called by the host view to mark which sat should render enlarged
 *  + brighter in the cloud. Pass null to clear. */
export function setHighlightedNoradId(id: number | null): void {
  if (highlightedNoradId === id) return
  highlightedNoradId = id
  for (const fn of highlightListeners) fn(id)
}

/** Subscribe to hover events for the lifetime of the calling component. */
export function useSatelliteHover(listener: HoverListener): void {
  useEffect(() => {
    hoverListeners.add(listener)
    return () => {
      hoverListeners.delete(listener)
    }
  }, [listener])
}

/** Subscribe to select events for the lifetime of the calling component. */
export function useSatelliteSelect(listener: SelectListener): void {
  useEffect(() => {
    selectListeners.add(listener)
    return () => {
      selectListeners.delete(listener)
    }
  }, [listener])
}

/** Read the live highlighted norad id as React state. Used by
 *  SatelliteCloud to re-tint the highlighted point. The useState
 *  initial value reads the module-level var, so subscribers mount
 *  with the current id; subsequent emissions update via the listener
 *  callback. The tiny race window between render and subscribe is
 *  acceptable — the next hover/select event will reconcile. */
export function useHighlightedNoradId(): number | null {
  const [id, setId] = useState<number | null>(highlightedNoradId)
  useEffect(() => {
    const listener: HighlightListener = (next) => setId(next)
    highlightListeners.add(listener)
    return () => {
      highlightListeners.delete(listener)
    }
  }, [])
  return id
}
