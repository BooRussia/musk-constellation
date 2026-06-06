// ============================================
// trajectory.ts — parametric launch flight path
// ============================================
// No public telemetry exists, so we model a believable ground track from
// what we DO have: the pad lat/lon, the target orbit category, and (for
// recent launches) the real event timeline. The vehicle climbs to orbit
// altitude during powered ascent, then coasts along its orbital ground
// track at the right angular rate to the deploy point. Heading comes from
// the standard launch-azimuth relation, with site-aware handling of the
// southerly Vandenberg corridors.

import type { PastLaunch } from './pastLaunches'

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
function easeOut(x: number): number {
  const t = clamp(x, 0, 1)
  return 1 - (1 - t) * (1 - t)
}

/** West-coast US pads (Vandenberg) launch SOUTH over the Pacific. */
function isVandenberg(lat: number, lon: number): boolean {
  return lon < -110 && lat > 30
}

/** SpaceX Starbase (Boca Chica, TX) — Starship flies an east-SOUTHEAST
 *  corridor over the Gulf, threading the Florida Straits south of the Keys,
 *  not the ENE heading a standard prograde insertion would imply. */
function isStarbase(lat: number, lon: number): boolean {
  return lat > 25 && lat < 27 && lon > -98 && lon < -96.5
}

/** Representative Starbase launch azimuth (deg) — east-southeast through the
 *  Florida Straits, matching the real Starship test-flight ground tracks. */
const STARBASE_AZIMUTH = 96

/** Representative target inclination (deg) for an orbit category + site. */
export function orbitInclination(orbit: string, padLat: number, padLon: number): number {
  const west = isVandenberg(padLat, padLon)
  switch (orbit) {
    case 'SSO':
      return 97.5 // sun-synchronous, retrograde
    case 'GTO':
      return 27
    case 'MEO':
      return 55
    case 'Sub':
      return 39 // suborbital / Starship test — short downrange
    case 'LEO':
    case 'N/A':
    default:
      // Starlink: ~43–53° from the Cape, higher shells from Vandenberg.
      return west ? 70 : 43
  }
}

/** Launch azimuth (deg clockwise from true north). Picks the southerly
 *  branch for retrograde orbits and for Vandenberg's coastal corridor. */
export function launchAzimuth(inclDeg: number, padLat: number, padLon: number): number {
  // Starbase flies a fixed east-southeast corridor regardless of the nominal
  // suborbital inclination (the prograde relation would point it ENE).
  if (isStarbase(padLat, padLon)) return STARBASE_AZIMUTH
  const a = Math.asin(clamp(Math.cos(inclDeg * RAD) / Math.cos(padLat * RAD), -1, 1)) * DEG
  const southerly = inclDeg > 90 || isVandenberg(padLat, padLon)
  return southerly ? 180 - a : a
}

/** Visible orbit altitude (km) — capped so the arc hugs the globe. */
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

/** Destination lat/lon (deg) a great-circle distance `arcDeg` from the pad
 *  along heading `azDeg`. */
function destPoint(
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

export interface LaunchProfile {
  inclination: number
  azimuth: number
  altKm: number
  /** Powered-ascent duration to orbital insertion (s). */
  ascentDur: number
  /** Full replay duration (s) — through the last event (deploy). */
  totalDur: number
  /** Position at mission time t (seconds from liftoff). */
  sample: (t: number) => { lat: number; lon: number; altKm: number }
}

const ASCENT_ARC_DEG = 22 // ground covered during powered ascent

/** Build a flight profile for a launch. Real event times set the cadence;
 *  the path shape is modeled. */
export function buildProfile(launch: PastLaunch): LaunchProfile {
  const { lat, lon } = launch.pad
  const inclination = orbitInclination(launch.orbit, lat, lon)
  const azimuth = launchAzimuth(inclination, lat, lon)
  const altKm = orbitAltKm(launch.orbit)

  // Insertion ≈ SECO-1; deploy ≈ last event. Fall back to canonical times.
  const evt = (re: RegExp): number | undefined =>
    launch.events.find((e) => re.test(e.label))?.t
  const ascentDur = evt(/SECO-?1|second engine cutoff/i) ?? evt(/MECO/i) ?? 540
  const lastEvent = launch.events.length ? launch.events[launch.events.length - 1].t : 0
  const totalDur = Math.max(lastEvent, ascentDur + 60)

  // Orbital ground-track angular rate (deg/s) at this altitude.
  const r = EARTH_R_KM + altKm
  const orbRateDegPerSec = Math.sqrt(MU / (r * r * r)) * DEG

  const sample = (t: number) => {
    let arcDeg: number
    let curAlt: number
    if (t <= ascentDur) {
      const f = ascentDur > 0 ? t / ascentDur : 1
      curAlt = altKm * smootherstep(f)
      arcDeg = ASCENT_ARC_DEG * easeOut(f)
    } else {
      curAlt = altKm
      arcDeg = ASCENT_ARC_DEG + orbRateDegPerSec * (t - ascentDur)
    }
    const { lat: dlat, lon: dlon } = destPoint(lat, lon, azimuth, arcDeg)
    return { lat: dlat, lon: dlon, altKm: curAlt }
  }

  return { inclination, azimuth, altKm, ascentDur, totalDur, sample }
}
