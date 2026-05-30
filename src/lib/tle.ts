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
export type ConstellationKey = 'starlink' | 'oneweb'

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

const CACHE_KEY_PREFIX = 'mc.tle.'
// Match CelesTrak's update cadence (2 hours) so we don't hammer
// their servers from a tab reload.
const CACHE_TTL_MS = 2 * 60 * 60 * 1000

interface CachedEntry {
  fetchedAt: number
  tleText: string
}

function readCache(group: ConstellationKey): string | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY_PREFIX + group)
    if (!raw) return null
    const parsed: CachedEntry = JSON.parse(raw)
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null
    return parsed.tleText
  } catch {
    return null
  }
}

function writeCache(group: ConstellationKey, tleText: string) {
  try {
    const entry: CachedEntry = { fetchedAt: Date.now(), tleText }
    sessionStorage.setItem(CACHE_KEY_PREFIX + group, JSON.stringify(entry))
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

/** Fetch + parse one constellation. Cached for 2h in sessionStorage. */
export async function fetchConstellation(
  group: ConstellationKey,
): Promise<SatelliteEntry[]> {
  let tleText = readCache(group)
  if (!tleText) {
    const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) {
      throw new Error(`CelesTrak ${group} responded ${res.status}`)
    }
    tleText = await res.text()
    // CelesTrak sometimes responds with a "no update" notice — detect
    // it and treat as transient (caller can retry, but for now we
    // surface an empty set instead of a parse error).
    if (tleText.includes('GP data has not updated')) {
      return []
    }
    writeCache(group, tleText)
  }
  return parseTleText(tleText, group)
}

/** Fetch every supported constellation in parallel. Tolerates per-
 *  constellation failures — if Starlink fails but OneWeb succeeds,
 *  you still see OneWeb. */
export async function fetchAllConstellations(): Promise<{
  satellites: SatelliteEntry[]
  errors: Array<{ group: ConstellationKey; error: unknown }>
}> {
  const groups: ConstellationKey[] = ['starlink', 'oneweb']
  const results = await Promise.allSettled(groups.map(g => fetchConstellation(g)))
  const satellites: SatelliteEntry[] = []
  const errors: Array<{ group: ConstellationKey; error: unknown }> = []
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') satellites.push(...r.value)
    else errors.push({ group: groups[i], error: r.reason })
  })
  return { satellites, errors }
}
