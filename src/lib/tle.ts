/**
 * TLE (Two-Line Element) fetcher + parser for live satellite tracking.
 *
 * CelesTrak's gp.php endpoint is the canonical public source for
 * publicly-tracked satellite orbits. It sends Access-Control-Allow-
 * Origin: * so browser-direct fetches work without a proxy. Data is
 * refreshed every 2 hours on their side; we cache locally in
 * sessionStorage so a tab-reload doesn't refetch unnecessarily.
 */

import { twoline2satrec, type SatRec } from 'satellite.js'

/** Constellation groupings that CelesTrak supports as named GROUPs. */
export type ConstellationKey =
  | 'starlink'
  | 'kuiper'
  | 'oneweb'
  | 'iridium'
  | 'globalstar'
  | 'orbcomm'
  | 'ses'
  | 'intelsat'
  | 'telesat'

export interface SatelliteEntry {
  /** Display name, e.g. "STARLINK-1007". */
  name: string
  /** NORAD catalog id, used for stable keying + dedup. */
  noradId: number
  /** Pre-parsed SGP4 record — pass to satellite.js propagate() each frame. */
  satrec: SatRec
  /** Which constellation this belongs to. */
  constellation: ConstellationKey
}

/**
 * Display + fetch metadata for one tracked constellation. The single
 * source of truth for CelesTrak GROUP names, dot colors, sidebar labels,
 * and which layers render on first load — consumed by the TLE fetcher
 * (group), the satellite cloud (color), and the sidebar legend.
 */
export interface ConstellationMeta {
  key: ConstellationKey
  /** CelesTrak GROUP query name — may differ from the key (e.g. the
   *  Iridium NEXT fleet is queried as "iridium-NEXT"). */
  group: string
  label: string
  sublabel: string
  /** Hex color for the sat dots AND the legend swatch (kept identical
   *  so the map reads back to the legend). */
  color: string
  /** Which shell the bulk of the fleet sits in. The far MEO/GEO
   *  operators get a "zoom out" hint because they orbit ~6× higher
   *  than the LEO broadband shells. */
  orbit: 'LEO' | 'MEO' | 'GEO'
  /** Whether the layer is visible on first load. The distant GEO/MEO
   *  operators default off so the opening shot is the tight, dense LEO
   *  broadband shell rather than stray dots at the frame edge. */
  defaultOn: boolean
}

// Order here = order in the sidebar legend. LEO broadband mega-
// constellations first (the headline acts — Starlink, Bezos' Kuiper,
// OneWeb), then the LEO comms/IoT fleets, then the high-altitude
// MEO/GEO operators (the Viasat-class geostationary internet birds —
// CelesTrak has no Viasat-only group, so SES / Intelsat / Telesat stand
// in for that geostationary category).
export const CONSTELLATIONS: ConstellationMeta[] = [
  // The six default-on LEO fleets share the same shell, so their hues
  // are picked to be maximally distinct from each other AND from the
  // blue Earth (cyan / magenta / amber / violet / emerald / red).
  { key: 'starlink',   group: 'starlink',     label: 'Starlink',   sublabel: 'SpaceX · LEO broadband',     color: '#9affef', orbit: 'LEO', defaultOn: true },
  { key: 'kuiper',     group: 'kuiper',       label: 'Kuiper',     sublabel: 'Amazon · LEO broadband',     color: '#ff63d2', orbit: 'LEO', defaultOn: true },
  { key: 'oneweb',     group: 'oneweb',       label: 'OneWeb',     sublabel: 'Eutelsat · LEO comms',       color: '#ffae3a', orbit: 'LEO', defaultOn: true },
  { key: 'iridium',    group: 'iridium-NEXT', label: 'Iridium',    sublabel: 'Iridium NEXT · LEO comms',   color: '#b07cff', orbit: 'LEO', defaultOn: true },
  { key: 'globalstar', group: 'globalstar',   label: 'Globalstar', sublabel: 'Globalstar · LEO comms',     color: '#3ee88f', orbit: 'LEO', defaultOn: true },
  { key: 'orbcomm',    group: 'orbcomm',      label: 'Orbcomm',    sublabel: 'Orbcomm · LEO IoT',          color: '#ff5a5a', orbit: 'LEO', defaultOn: true },
  // The high-altitude MEO/GEO operators stand in for the Viasat-class
  // geostationary internet category (no Viasat-only CelesTrak group).
  { key: 'ses',        group: 'ses',          label: 'SES / O3b',  sublabel: 'SES · MEO + GEO · zoom out', color: '#c9f24a', orbit: 'MEO', defaultOn: false },
  { key: 'intelsat',   group: 'intelsat',     label: 'Intelsat',   sublabel: 'Intelsat · GEO · zoom out',  color: '#ff9a3a', orbit: 'GEO', defaultOn: false },
  { key: 'telesat',    group: 'telesat',      label: 'Telesat',    sublabel: 'Telesat · GEO · zoom out',   color: '#34d6c8', orbit: 'GEO', defaultOn: false },
]

const CONSTELLATION_BY_KEY = Object.fromEntries(
  CONSTELLATIONS.map((c) => [c.key, c]),
) as Record<ConstellationKey, ConstellationMeta>

/** Keys that render on first load (the LEO broadband + comms shells). */
export const DEFAULT_ENABLED_CONSTELLATIONS: ConstellationKey[] =
  CONSTELLATIONS.filter((c) => c.defaultOn).map((c) => c.key)

// v2 cache key — bumped to invalidate any poisoned entries from the
// proxy-era (which could have cached 404 HTML).
const CACHE_KEY_PREFIX = 'mc.tle.v2.'
// "Fresh" window — if cached data is younger than this we skip the
// network entirely. 6h keeps us well under CelesTrak's throttle while
// still picking up new launches within a day. TLEs stay accurate for
// days regardless, so even much older cache is usable as a fallback.
const CACHE_FRESH_MS = 6 * 60 * 60 * 1000
// Hard cap on how stale a cached TLE we'll still fall back to when
// CelesTrak refuses a re-download (its "GP data has not updated"
// throttle). 3 days — orbital elements drift slowly enough that
// positions are still visually fine.
const CACHE_MAX_FALLBACK_MS = 3 * 24 * 60 * 60 * 1000

interface CachedEntry {
  fetchedAt: number
  tleText: string
}

// localStorage (not sessionStorage) so the cache survives a tab close
// — critical because CelesTrak throttles repeat downloads per-IP for
// 2 hours, so a returning visitor must fall back to persisted data
// rather than getting an empty sky.
function rawReadCache(group: ConstellationKey): CachedEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + group)
    if (!raw) return null
    return JSON.parse(raw) as CachedEntry
  } catch {
    return null
  }
}

/** Returns cached TLE text only if it's still "fresh" (< 6h). Used
 *  to short-circuit the network on a quick reload. */
function readFreshCache(group: ConstellationKey): string | null {
  const entry = rawReadCache(group)
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > CACHE_FRESH_MS) return null
  return entry.tleText
}

/** Returns cached TLE text if it exists and is within the hard
 *  fallback window (< 3 days), regardless of freshness. Used when
 *  CelesTrak refuses a re-download. */
function readFallbackCache(group: ConstellationKey): string | null {
  const entry = rawReadCache(group)
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > CACHE_MAX_FALLBACK_MS) return null
  return entry.tleText
}

function writeCache(group: ConstellationKey, tleText: string) {
  try {
    const entry: CachedEntry = { fetchedAt: Date.now(), tleText }
    localStorage.setItem(CACHE_KEY_PREFIX + group, JSON.stringify(entry))
  } catch {
    // Quota exceeded / private mode — silent, just no caching.
  }
}

/** Parse CelesTrak 3-line TLE text into satellite entries. */
function parseTleText(tleText: string, constellation: ConstellationKey): SatelliteEntry[] {
  const lines = tleText.split('\n').map(l => l.trimEnd()).filter(Boolean)
  const out: SatelliteEntry[] = []
  // TLEs come in triplets: name / line 1 / line 2.
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i].trim()
    const l1 = lines[i + 1]
    const l2 = lines[i + 2]
    if (!l1?.startsWith('1 ') || !l2?.startsWith('2 ')) continue
    try {
      const satrec = twoline2satrec(l1, l2)
      // NORAD id is on line 1 columns 3-7.
      const noradId = parseInt(l1.substring(2, 7).trim(), 10)
      if (!Number.isFinite(noradId)) continue
      out.push({ name, noradId, satrec, constellation })
    } catch {
      // Bad TLE row — skip.
    }
  }
  return out
}

/** Fetch + parse one constellation, with a localStorage-backed cache
 *  that's resilient to CelesTrak's per-IP download throttle.
 *
 *  CelesTrak refuses to re-send the same GROUP within a 2h window from
 *  the same IP — it returns a "GP data has not updated since your last
 *  successful download" notice instead of data. A returning visitor
 *  (or anyone who reloads) would otherwise get an empty sky. So:
 *    1. Fresh cache (< 6h)        → use it, skip the network entirely.
 *    2. Otherwise fetch CelesTrak directly (CORS *, CSP-whitelisted).
 *       - Real data → cache + return.
 *       - "No update" throttle notice → fall back to cached data
 *         (up to 3 days old — TLEs stay accurate for days).
 *    3. Network/HTTP error → fall back to cached data if we have any,
 *       else rethrow so the UI can show the real error. */
export async function fetchConstellation(
  group: ConstellationKey,
): Promise<SatelliteEntry[]> {
  // 1. Fresh cache short-circuit.
  const fresh = readFreshCache(group)
  if (fresh) return parseTleText(fresh, group)

  // The CelesTrak GROUP can differ from our stable key (e.g. key
  // "iridium" → group "iridium-NEXT"); the localStorage cache stays
  // keyed by our key so it survives group-name changes.
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${CONSTELLATION_BY_KEY[group].group}&FORMAT=tle`
  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    // Network-level failure (DNS, refused, CSP-blocked, offline).
    // Use any non-expired cached data before giving up.
    const fallback = readFallbackCache(group)
    if (fallback) {
      console.warn(`[tle] ${group} fetch failed, using cached data`)
      return parseTleText(fallback, group)
    }
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`TLE fetch network error for ${group}: ${msg}`, { cause: err })
  }

  if (!res.ok) {
    const fallback = readFallbackCache(group)
    if (fallback) {
      console.warn(`[tle] ${group} returned ${res.status}, using cached data`)
      return parseTleText(fallback, group)
    }
    throw new Error(`CelesTrak returned ${res.status} for ${group}`)
  }

  const tleText = await res.text()

  // CelesTrak's throttle notice — fall back to cached data.
  if (tleText.includes('GP data has not updated')) {
    const fallback = readFallbackCache(group)
    if (fallback) {
      console.warn(`[tle] ${group} throttled by CelesTrak, using cached data`)
      return parseTleText(fallback, group)
    }
    // Cold start + throttled (rare — only if this IP already pulled
    // recently with no local cache). Surface as empty.
    console.warn(`[tle] ${group} throttled by CelesTrak and no cache available`)
    return []
  }

  writeCache(group, tleText)
  return parseTleText(tleText, group)
}

// ============================================
// ISS — single tracked object (NORAD 25544)
// ============================================
// The station has a public TLE just like everything else, so we track its
// live position with the same SGP4 pipeline rather than a separate
// position API. Crew / docked-Dragon context is curated (see data/iss.ts).

export interface TrackedObject {
  name: string
  noradId: number
  satrec: SatRec
}

const ISS_NORAD = 25544
const ISS_CACHE_KEY = 'mc.iss.v1'

function parseSingleTle(tleText: string): TrackedObject | null {
  const lines = tleText.split('\n').map((l) => l.trimEnd()).filter(Boolean)
  for (let i = 0; i + 1 < lines.length; i++) {
    const l1 = lines[i]
    const l2 = lines[i + 1]
    if (l1?.startsWith('1 ') && l2?.startsWith('2 ')) {
      try {
        const satrec = twoline2satrec(l1, l2)
        const noradId = parseInt(l1.substring(2, 7).trim(), 10)
        // The name line (if present) sits just above line 1.
        const name = i > 0 ? lines[i - 1].trim() : 'ISS'
        return { name, noradId, satrec }
      } catch {
        return null
      }
    }
  }
  return null
}

/** Fetch the ISS TLE from CelesTrak (CATNR lookup), with the same
 *  fresh/fallback localStorage caching the constellations use. */
export async function fetchISS(): Promise<TrackedObject | null> {
  function readCache(maxAgeMs: number): TrackedObject | null {
    try {
      const raw = localStorage.getItem(ISS_CACHE_KEY)
      if (!raw) return null
      const e = JSON.parse(raw) as CachedEntry
      if (Date.now() - e.fetchedAt > maxAgeMs) return null
      return parseSingleTle(e.tleText)
    } catch {
      return null
    }
  }

  const fresh = readCache(CACHE_FRESH_MS)
  if (fresh) return fresh

  const url = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${ISS_NORAD}&FORMAT=tle`
  try {
    const res = await fetch(url)
    if (res.ok) {
      const text = await res.text()
      if (!text.includes('GP data has not updated')) {
        try {
          localStorage.setItem(
            ISS_CACHE_KEY,
            JSON.stringify({ fetchedAt: Date.now(), tleText: text }),
          )
        } catch {
          // quota / private mode — no caching
        }
        const parsed = parseSingleTle(text)
        if (parsed) return parsed
      }
    }
  } catch {
    // fall through to stale cache
  }
  return readCache(CACHE_MAX_FALLBACK_MS)
}

/** Fetch every supported constellation in parallel. Tolerates per-
 *  constellation failures — if Starlink fails but OneWeb succeeds,
 *  you still see OneWeb. */
export async function fetchAllConstellations(): Promise<{
  satellites: SatelliteEntry[]
  errors: Array<{ group: ConstellationKey; error: unknown }>
}> {
  const groups: ConstellationKey[] = CONSTELLATIONS.map((c) => c.key)
  const results = await Promise.allSettled(groups.map(g => fetchConstellation(g)))
  const satellites: SatelliteEntry[] = []
  const errors: Array<{ group: ConstellationKey; error: unknown }> = []
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') satellites.push(...r.value)
    else errors.push({ group: groups[i], error: r.reason })
  })
  return { satellites, errors }
}
