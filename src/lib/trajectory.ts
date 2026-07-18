// ============================================
// trajectory.ts — parametric launch flight path
// ============================================
// No public per-launch telemetry exists, so we model a believable path from
// pad lat/lon, orbit category, and (when present) real event times. Altitude
// follows a typical Falcon 9 / Starlink sample table keyed to Max-Q, MECO,
// SECO-1, and deploy — not raw GPS. Ground track uses launch azimuth + a
// gravity-turn-ish downrange ease tied to the same knots.

import type { PastLaunch } from './pastLaunches'
import { falcon9FlightEvents } from './launchSequence'

const DEG = 180 / Math.PI
const RAD = Math.PI / 180
const EARTH_R_KM = 6371
const MU = 398600.4418 // km^3/s^2

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
function smootherstep(x: number): number {
  const t = clamp(x, 0, 1)
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/** West-coast US pads (Vandenberg) launch SOUTH over the Pacific. */
function isVandenberg(lat: number, lon: number): boolean {
  return lon < -110 && lat > 30
}

/** SpaceX Starbase (Boca Chica, TX) — Starship east-southeast corridor. */
function isStarbase(lat: number, lon: number): boolean {
  return lat > 25 && lat < 27 && lon > -98 && lon < -96.5
}

const STARBASE_AZIMUTH = 96

/** Representative target inclination (deg) for an orbit category + site. */
export function orbitInclination(orbit: string, padLat: number, padLon: number): number {
  const west = isVandenberg(padLat, padLon)
  switch (orbit) {
    case 'SSO':
      return 97.5
    case 'GTO':
      return 27
    case 'MEO':
      return 55
    case 'Sub':
      return 39
    case 'LEO':
    case 'N/A':
    default:
      return west ? 70 : 43
  }
}

/** Launch azimuth (deg clockwise from true north). */
export function launchAzimuth(inclDeg: number, padLat: number, padLon: number): number {
  if (isStarbase(padLat, padLon)) return STARBASE_AZIMUTH
  const a = Math.asin(clamp(Math.cos(inclDeg * RAD) / Math.cos(padLat * RAD), -1, 1)) * DEG
  const southerly = inclDeg > 90 || isVandenberg(padLat, padLon)
  return southerly ? 180 - a : a
}

/** Insertion / deploy shell altitude (km) by orbit category. */
function orbitAltKm(orbit: string): number {
  switch (orbit) {
    case 'SSO':
      return 550
    case 'MEO':
      return 700
    case 'GTO':
      return 600
    case 'Sub':
      return 150
    default:
      return 420
  }
}

/** Destination lat/lon (deg) a great-circle distance `arcDeg` from the pad. */
export function destPoint(
  latDeg: number,
  lonDeg: number,
  azDeg: number,
  arcDeg: number,
): { lat: number; lon: number } {
  const lat1 = latDeg * RAD
  const lon1 = lonDeg * RAD
  const az = azDeg * RAD
  const d = arcDeg * RAD
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(az),
  )
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(az) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    )
  return { lat: lat2 * DEG, lon: lon2 * DEG }
}

/** Named altitude / downrange waypoints (typical Falcon 9 profile). */
export type AltitudePhase = 'liftoff' | 'maxq' | 'meco' | 'seco' | 'deploy'

export interface AltitudeWaypoint {
  phase: AltitudePhase
  /** Mission time (s from liftoff). */
  t: number
  /** Geometric altitude (km) — modeled typical, not telemetry. */
  altKm: number
  /** Cumulative ground-track arc (deg) at this knot. */
  arcDeg: number
}

export interface SampledState {
  lat: number
  lon: number
  /** Modeled geometric altitude (km). */
  altKm: number
  /** Great-circle downrange from the pad (km). */
  downrangeKm: number
  /** 0–1 throttle proxy for flame (1 during ascent burns, ~0 on coast). */
  thrust: number
}

export interface LaunchProfile {
  inclination: number
  azimuth: number
  /** Target shell altitude (km). */
  altKm: number
  /** Powered ascent to SECO / insertion (s). */
  ascentDur: number
  /** Full replay duration (s). */
  totalDur: number
  /** Interpolated altitude / arc knots. */
  waypoints: AltitudeWaypoint[]
  sample: (t: number) => SampledState
}

/** Typical altitudes (km) by phase for each orbit family. */
function phaseAlts(orbit: string, shellKm: number): Record<AltitudePhase, number> {
  switch (orbit) {
    case 'GTO':
      return { liftoff: 0, maxq: 13, meco: 80, seco: 180, deploy: shellKm }
    case 'SSO':
      return { liftoff: 0, maxq: 13, meco: 75, seco: 240, deploy: shellKm }
    case 'MEO':
      return { liftoff: 0, maxq: 14, meco: 90, seco: 280, deploy: shellKm }
    case 'Sub':
      return { liftoff: 0, maxq: 12, meco: 60, seco: 120, deploy: shellKm }
    default:
      // LEO / Starlink — published webcast-typical figures
      return { liftoff: 0, maxq: 13, meco: 70, seco: 210, deploy: shellKm }
  }
}

/** Typical ground-arc (deg) at each phase — gravity-turn-ish. */
function phaseArcs(orbit: string): Record<AltitudePhase, number> {
  switch (orbit) {
    case 'Sub':
      return { liftoff: 0, maxq: 0.8, meco: 4, seco: 10, deploy: 14 }
    case 'GTO':
      return { liftoff: 0, maxq: 1.2, meco: 7, seco: 18, deploy: 28 }
    default:
      return { liftoff: 0, maxq: 1.1, meco: 6.5, seco: 16, deploy: 24 }
  }
}

function findEventTime(events: { label: string; t: number }[], re: RegExp): number | undefined {
  return events.find((e) => re.test(e.label))?.t
}

/** Build timed knots from launch events (or Falcon 9 canonical fallback). */
function buildWaypoints(
  launch: PastLaunch,
  shellKm: number,
): { waypoints: AltitudeWaypoint[]; ascentDur: number; totalDur: number } {
  const events = launch.events.length ? launch.events : falcon9FlightEvents()
  const alts = phaseAlts(launch.orbit, shellKm)
  const arcs = phaseArcs(launch.orbit)

  const tLiftoff = 0
  const tMaxQ =
    findEventTime(events, /max[\s-]?q/i) ??
    findEventTime(falcon9FlightEvents(), /max[\s-]?q/i) ??
    72
  const tMeco =
    findEventTime(events, /\bmeco\b|main engine cutoff/i) ??
    findEventTime(falcon9FlightEvents(), /\bmeco\b/i) ??
    132
  const tSeco =
    findEventTime(events, /seco-?1|second engine cutoff/i) ??
    findEventTime(events, /seco/i) ??
    510
  const tDeploy =
    findEventTime(events, /deploy|payload|starlink/i) ??
    events[events.length - 1]?.t ??
    Math.max(tSeco + 60, 3900)

  const t1 = Math.max(tLiftoff + 1, tMaxQ)
  const t2 = Math.max(t1 + 1, tMeco)
  const t3 = Math.max(t2 + 1, tSeco)
  const t4 = Math.max(t3 + 30, tDeploy)

  const waypoints: AltitudeWaypoint[] = [
    { phase: 'liftoff', t: tLiftoff, altKm: alts.liftoff, arcDeg: arcs.liftoff },
    { phase: 'maxq', t: t1, altKm: alts.maxq, arcDeg: arcs.maxq },
    { phase: 'meco', t: t2, altKm: alts.meco, arcDeg: arcs.meco },
    { phase: 'seco', t: t3, altKm: alts.seco, arcDeg: arcs.seco },
    { phase: 'deploy', t: t4, altKm: alts.deploy, arcDeg: arcs.deploy },
  ]

  const ascentDur = t3
  const lastEvent = events.length ? events[events.length - 1].t : 0
  const totalDur = Math.max(lastEvent, t4, ascentDur + 60)

  return { waypoints, ascentDur, totalDur }
}

function lerpWaypoints(
  waypoints: AltitudeWaypoint[],
  t: number,
): { altKm: number; arcDeg: number } {
  if (t <= waypoints[0].t) return { altKm: waypoints[0].altKm, arcDeg: waypoints[0].arcDeg }
  const last = waypoints[waypoints.length - 1]
  if (t >= last.t) return { altKm: last.altKm, arcDeg: last.arcDeg }

  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i]
    const b = waypoints[i + 1]
    if (t > b.t) continue
    const span = b.t - a.t
    const f = span > 0 ? smootherstep((t - a.t) / span) : 1
    return {
      altKm: a.altKm + (b.altKm - a.altKm) * f,
      arcDeg: a.arcDeg + (b.arcDeg - a.arcDeg) * f,
    }
  }
  return { altKm: last.altKm, arcDeg: last.arcDeg }
}

/** Thrust proxy: strong on first-stage ascent, medium on second stage, off after SECO. */
function thrustAt(t: number, waypoints: AltitudeWaypoint[]): number {
  const maxq = waypoints.find((w) => w.phase === 'maxq')?.t ?? 72
  const meco = waypoints.find((w) => w.phase === 'meco')?.t ?? 132
  const seco = waypoints.find((w) => w.phase === 'seco')?.t ?? 510
  if (t < 0) return 0
  if (t < meco) {
    if (t < maxq) return 0.55 + 0.45 * smootherstep(t / Math.max(maxq, 1))
    return 1
  }
  if (t < seco) {
    const gap = 12
    if (t < meco + gap) return 0.05
    return 0.72
  }
  return 0
}

export function altitudeAt(profile: LaunchProfile, t: number): number {
  return profile.sample(t).altKm
}

/** Modeled altitude (km) at a named phase for this profile. */
export function eventAltitude(profile: LaunchProfile, phase: AltitudePhase): number {
  return profile.waypoints.find((w) => w.phase === phase)?.altKm ?? 0
}

/** Build a flight profile for a launch. */
export function buildProfile(launch: PastLaunch): LaunchProfile {
  const { lat, lon } = launch.pad
  const inclination = orbitInclination(launch.orbit, lat, lon)
  const azimuth = launchAzimuth(inclination, lat, lon)
  const altKm = orbitAltKm(launch.orbit)
  const { waypoints, ascentDur, totalDur } = buildWaypoints(launch, altKm)

  const shellR = EARTH_R_KM + altKm
  const orbRateDegPerSec = Math.sqrt(MU / (shellR * shellR * shellR)) * DEG
  const secoArc = waypoints.find((w) => w.phase === 'seco')?.arcDeg ?? 16

  const sample = (t: number): SampledState => {
    const tt = Math.max(0, t)
    let arcDeg: number
    let curAlt: number
    if (tt <= ascentDur) {
      const w = lerpWaypoints(waypoints, tt)
      curAlt = w.altKm
      arcDeg = w.arcDeg
    } else {
      const w = lerpWaypoints(waypoints, tt)
      curAlt = w.altKm
      arcDeg = secoArc + orbRateDegPerSec * (tt - ascentDur)
      if (tt <= waypoints[waypoints.length - 1].t) {
        arcDeg = Math.max(arcDeg, w.arcDeg)
      }
    }
    const { lat: dlat, lon: dlon } = destPoint(lat, lon, azimuth, arcDeg)
    const downrangeKm = arcDeg * RAD * EARTH_R_KM
    return {
      lat: dlat,
      lon: dlon,
      altKm: curAlt,
      downrangeKm,
      thrust: thrustAt(tt, waypoints),
    }
  }

  return { inclination, azimuth, altKm, ascentDur, totalDur, waypoints, sample }
}
