// ============================================
// launchSequence.ts — Falcon 9 countdown + flight timeline
// ============================================
// Canonical SpaceX Falcon 9 milestones for the live tracker, plus a shared
// "stage action" vocabulary so live + past-replay UIs can fire the same
// pronounced visual beats (callouts, vehicle intensity, phase theming).

export type SeqPhase = 'pre' | 'flight'

/** Defined stage actions — each drives a distinct visual treatment. */
export type StageAction =
  | 'propellant'
  | 'pad'
  | 'startup'
  | 'ignition'
  | 'liftoff'
  | 'ascent'
  | 'meco'
  | 'separation'
  | 'second_stage'
  | 'fairing'
  | 'entry'
  | 'landing'
  | 'orbit'
  | 'deploy'
  | 'generic'

export interface StageActionMeta {
  action: StageAction
  /** Short verb shown in banners / badges. */
  verb: string
  /** Accent color for callouts and markers. */
  color: string
  /** Relative visual intensity 0–1 (vehicle glow, banner weight). */
  intensity: number
  /** Chapter label for timeline grouping. */
  chapter: 'Countdown' | 'Ascent' | 'Booster' | 'Orbit' | 'Deploy'
}

export const STAGE_ACTIONS: Record<StageAction, StageActionMeta> = {
  propellant: {
    action: 'propellant',
    verb: 'FUELING',
    color: '#7dd3fc',
    intensity: 0.35,
    chapter: 'Countdown',
  },
  pad: {
    action: 'pad',
    verb: 'PAD OPS',
    color: '#a5b4fc',
    intensity: 0.4,
    chapter: 'Countdown',
  },
  startup: {
    action: 'startup',
    verb: 'STARTUP',
    color: '#fbbf24',
    intensity: 0.55,
    chapter: 'Countdown',
  },
  ignition: {
    action: 'ignition',
    verb: 'IGNITION',
    color: '#fb923c',
    intensity: 0.85,
    chapter: 'Countdown',
  },
  liftoff: {
    action: 'liftoff',
    verb: 'LIFTOFF',
    color: '#ff6b2c',
    intensity: 1,
    chapter: 'Ascent',
  },
  ascent: {
    action: 'ascent',
    verb: 'ASCENT',
    color: '#ff9a4a',
    intensity: 0.75,
    chapter: 'Ascent',
  },
  meco: {
    action: 'meco',
    verb: 'MECO',
    color: '#fda4af',
    intensity: 0.7,
    chapter: 'Ascent',
  },
  separation: {
    action: 'separation',
    verb: 'STAGE SEP',
    color: '#f0abfc',
    intensity: 0.8,
    chapter: 'Ascent',
  },
  second_stage: {
    action: 'second_stage',
    verb: 'SES',
    color: '#c4b5fd',
    intensity: 0.65,
    chapter: 'Ascent',
  },
  fairing: {
    action: 'fairing',
    verb: 'FAIRING',
    color: '#e2e8f0',
    intensity: 0.55,
    chapter: 'Ascent',
  },
  entry: {
    action: 'entry',
    verb: 'ENTRY BURN',
    color: '#fb7185',
    intensity: 0.8,
    chapter: 'Booster',
  },
  landing: {
    action: 'landing',
    verb: 'LANDING',
    color: '#34d399',
    intensity: 0.9,
    chapter: 'Booster',
  },
  orbit: {
    action: 'orbit',
    verb: 'ORBIT',
    color: '#38bdf8',
    intensity: 0.6,
    chapter: 'Orbit',
  },
  deploy: {
    action: 'deploy',
    verb: 'DEPLOY',
    color: '#a3e635',
    intensity: 1,
    chapter: 'Deploy',
  },
  generic: {
    action: 'generic',
    verb: 'EVENT',
    color: '#ffb066',
    intensity: 0.5,
    chapter: 'Ascent',
  },
}

export interface SeqEvent {
  label: string
  /** Seconds relative to liftoff (negative before, positive after). */
  t: number
  phase: SeqPhase
  action: StageAction
}

// Falcon 9 — Starlink-class profile (no fairing event; ASDS booster landing).
export const FALCON9_SEQUENCE: SeqEvent[] = [
  { label: 'Go for Prop Load', t: -38 * 60, phase: 'pre', action: 'propellant' },
  { label: 'Propellant Load Begins', t: -35 * 60, phase: 'pre', action: 'propellant' },
  { label: 'LOX Chilldown', t: -20 * 60 - 20, phase: 'pre', action: 'propellant' },
  { label: 'S2 LOX Load Begins', t: -16 * 60, phase: 'pre', action: 'propellant' },
  { label: 'Engine Chill', t: -7 * 60, phase: 'pre', action: 'startup' },
  { label: 'Strongback Retract', t: -4 * 60 - 30, phase: 'pre', action: 'pad' },
  { label: 'Stage 1 LOX Loaded', t: -3 * 60 - 10, phase: 'pre', action: 'propellant' },
  { label: 'Stage 2 LOX Loaded', t: -2 * 60 - 10, phase: 'pre', action: 'propellant' },
  { label: 'F9 In Startup', t: -60, phase: 'pre', action: 'startup' },
  { label: 'Propellant Tanks Pressurize', t: -45, phase: 'pre', action: 'startup' },
  { label: 'LD Go for Launch', t: -40, phase: 'pre', action: 'startup' },
  { label: 'Engine Ignition', t: -3, phase: 'pre', action: 'ignition' },
  { label: 'Liftoff', t: 0, phase: 'flight', action: 'liftoff' },
  { label: 'Max-Q', t: 72, phase: 'flight', action: 'ascent' },
  { label: 'MECO', t: 132, phase: 'flight', action: 'meco' },
  { label: 'Stage Separation', t: 136, phase: 'flight', action: 'separation' },
  { label: 'Second Engine Start', t: 144, phase: 'flight', action: 'second_stage' },
  { label: 'Stage 1 Entry Burn', t: 390, phase: 'flight', action: 'entry' },
  { label: 'SECO-1', t: 510, phase: 'flight', action: 'orbit' },
  { label: 'Stage 1 Landing', t: 522, phase: 'flight', action: 'landing' },
  { label: 'Satellite Deploy', t: 3900, phase: 'flight', action: 'deploy' },
]

/** Map arbitrary LL2 / past-launch event labels onto our stage actions. */
export function resolveStageAction(label: string): StageAction {
  const s = label.toLowerCase()
  if (/liftoff|lift[\s-]?off|t-?0\b/.test(s)) return 'liftoff'
  if (/ignition|engine start.?up|startup/.test(s) && /engine|merlin|ignition/.test(s)) return 'ignition'
  if (/max[\s-]?q/.test(s)) return 'ascent'
  if (/\bmeco\b|main engine cutoff|first.?stage cutoff/.test(s)) return 'meco'
  if (/stage\s*(sep|separation)|s1.?sep|booster sep/.test(s)) return 'separation'
  if (/\bses\b|second engine start|s2.?ignition|ses-?1/.test(s)) return 'second_stage'
  if (/fairing/.test(s)) return 'fairing'
  if (/entry\s*burn|reentry|re-entry/.test(s)) return 'entry'
  if (/landing\s*burn|landing|touchdown|rtls|asds/.test(s)) return 'landing'
  if (/\bseco\b|second engine cutoff|orbital insertion/.test(s)) return 'orbit'
  if (/deploy|deployment|payload|starlink deploy/.test(s)) return 'deploy'
  if (/propellant|lox|rp-1|fuel|chill|load/.test(s)) return 'propellant'
  if (/strongback|transporter|pad|hold.?down/.test(s)) return 'pad'
  if (/pressur|go for launch|startup|f9 in/.test(s)) return 'startup'
  return 'generic'
}

export function stageMetaForLabel(label: string): StageActionMeta {
  return STAGE_ACTIONS[resolveStageAction(label)]
}

export function stageMetaForEvent(e: Pick<SeqEvent, 'action' | 'label'>): StageActionMeta {
  return STAGE_ACTIONS[e.action ?? resolveStageAction(e.label)]
}

/** Flight-only events for live post-liftoff simulation. */
export function falcon9FlightEvents(): Array<{ label: string; t: number }> {
  return FALCON9_SEQUENCE.filter((e) => e.t >= 0).map((e) => ({ label: e.label, t: e.t }))
}

/**
 * Prefer a real past-launch timeline; fall back to the canonical Falcon 9
 * flight profile so replays without LL2 events still show milestones.
 */
export function eventsForReplay(
  events: Array<{ label: string; t: number }>,
): Array<{ label: string; t: number }> {
  if (events.length > 0) return events
  return falcon9FlightEvents()
}

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
