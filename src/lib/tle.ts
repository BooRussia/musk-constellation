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

/** Fetch + parse one constellation. Cached for 2h in sessionStorage.
 *  Hits /api/tle/<group> which Netlify proxies to CelesTrak — keeps
 *  the fetch same-origin so CORS and corporate-network filters can't
 *  break it. Dev (vite dev server) doesn't proxy, so we fall back to
 *  CelesTrak directly when localhost. */
export async function fetchConstellation(
  group: ConstellationKey,
): Promise<SatelliteEntry[]> {
  let tleText = readCache(group)
  if (!tleText) {
    // Fetch CelesTrak directly. CelesTrak sends Access-Control-Allow-
    // Origin: * so a browser fetch works cross-origin. We do NOT use a
    // same-origin proxy because the live deploy is GitHub Pages, which
    // is a static host with no rewrite engine — a /api/tle/* proxy
    // only exists in (inert) Netlify config and would 404 on Pages.
    // The one catch: a strict CSP connect-src would block this, so the
    // Netlify CSP whitelists https://celestrak.org (GitHub Pages has no
    // CSP header at all, so it's unaffected).
    const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`
    let res: Response
    try {
      res = await fetch(url)
    } catch (err) {
      // Network-level failure (DNS, refused, CSP-blocked, offline).
      // Surface a clear message instead of the opaque "Failed to fetch".
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`TLE fetch network error for ${group}: ${msg}`, { cause: err })
    }
    if (!res.ok) {
      throw new Error(`CelesTrak returned ${res.status} for ${group}`)
    }
    tleText = await res.text()
    // CelesTrak occasionally returns a "no update" notice instead of
    // data — treat as empty rather than a parse failure.
    if (tleText.includes('GP data has not updated')) {
      console.warn(`[tle] CelesTrak returned no-update notice for ${group}`)
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
