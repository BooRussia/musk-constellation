// ============================================
// launchSequence.ts — canonical Falcon 9 countdown + flight timeline
// ============================================
// The Launch Library 2 "upcoming" feed rarely carries a per-launch event
// timeline, so we drive the live tracker's event sequence from the standard
// SpaceX Falcon 9 countdown + ascent milestones. Times are seconds relative
// to liftoff (negative = countdown). These are the nominal published values
// — the same ones the SpaceX webcast clock and apps like Next Spaceflight
// show — so the sequence reads true even before the real telemetry exists.

export type SeqPhase = 'pre' | 'flight'

export interface SeqEvent {
  label: string
  /** Seconds relative to liftoff (negative before, positive after). */
  t: number
  phase: SeqPhase
}

// Falcon 9 — Starlink-class profile (no fairing event; ASDS booster landing).
export const FALCON9_SEQUENCE: SeqEvent[] = [
  { label: 'Go for Prop Load', t: -38 * 60, phase: 'pre' },
  { label: 'Propellant Load Begins', t: -35 * 60, phase: 'pre' },
  { label: 'LOX Chilldown', t: -20 * 60 - 20, phase: 'pre' },
  { label: 'S2 LOX Load Begins', t: -16 * 60, phase: 'pre' },
  { label: 'Engine Chill', t: -7 * 60, phase: 'pre' },
  { label: 'Strongback Retract', t: -4 * 60 - 30, phase: 'pre' },
  { label: 'Stage 1 LOX Loaded', t: -3 * 60 - 10, phase: 'pre' },
  { label: 'Stage 2 LOX Loaded', t: -2 * 60 - 10, phase: 'pre' },
  { label: 'F9 In Startup', t: -60, phase: 'pre' },
  { label: 'Propellant Tanks Pressurize', t: -45, phase: 'pre' },
  { label: 'LD Go for Launch', t: -45, phase: 'pre' },
  { label: 'Engine Ignition', t: -3, phase: 'pre' },
  { label: 'Liftoff', t: 0, phase: 'flight' },
  { label: 'Max-Q', t: 72, phase: 'flight' },
  { label: 'MECO', t: 132, phase: 'flight' },
  { label: 'Stage Separation', t: 136, phase: 'flight' },
  { label: 'Second Engine Start', t: 144, phase: 'flight' },
  { label: 'Stage 1 Entry Burn', t: 390, phase: 'flight' },
  { label: 'SECO-1', t: 510, phase: 'flight' },
  { label: 'Stage 1 Landing', t: 522, phase: 'flight' },
  { label: 'Satellite Deploy', t: 3900, phase: 'flight' },
]

const PAD = (n: number) => String(n).padStart(2, '0')

/** "T- 00:38:00" / "T+ 00:02:16" for a liftoff-relative time in seconds. */
export function offsetLabel(t: number): string {
  const sign = t < 0 ? 'T-' : 'T+'
  let s = Math.abs(Math.round(t))
  const h = Math.floor(s / 3600)
  s -= h * 3600
  const m = Math.floor(s / 60)
  s -= m * 60
  return `${sign} ${PAD(h)}:${PAD(m)}:${PAD(s)}`
}
