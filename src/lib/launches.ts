// ============================================
// Upcoming SpaceX launches — Launch Library 2 (The Space Devs)
// ============================================
// Free, public, CORS-enabled. The unauthenticated tier is rate-limited
// (~15 req/hr per IP), so we cache aggressively in localStorage and only
// hit the network when the cache is stale. One fetch covers the whole
// view; the countdown then ticks client-side off the returned `net` time.

export interface UpcomingLaunch {
  id: string
  /** Mission / launch name, e.g. "Starlink Group 12-5". */
  name: string
  /** Rocket, e.g. "Falcon 9 Block 5". */
  rocket: string
  /** Launch pad + location, e.g. "SLC-40, Cape Canaveral". */
  pad: string
  /** Net (no-earlier-than) launch time, ISO string. */
  net: string
  /** How firm the time is (GO / TBD / TBC …). */
  status: string
}

const LL2_URL =
  'https://ll.thespacedevs.com/2.2.0/launch/upcoming/' +
  // SpaceX only; hide_recent_previous drops just-passed launches the
  // "upcoming" feed otherwise keeps for a week; list mode is the light
  // payload (its `name` is "Rocket | Mission", which we split below).
  '?limit=6&mode=list&hide_recent_previous=true&lsp__name=SpaceX'
const CACHE_KEY = 'mc.launches.v1'
// LL2 free tier throttles hard — 30 min cache keeps us well under it while
// staying fresh enough for a countdown (net times rarely move minute-to-
// minute).
const FRESH_MS = 30 * 60 * 1000
const FALLBACK_MS = 24 * 60 * 60 * 1000

interface Cached {
  fetchedAt: number
  launches: UpcomingLaunch[]
}

function readCache(maxAgeMs: number): UpcomingLaunch[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as Cached
    if (Date.now() - c.fetchedAt > maxAgeMs) return null
    return c.launches
  } catch {
    return null
  }
}

// LL2 "list" mode returns a lighter shape than the detailed endpoint.
interface LL2ListResult {
  id: string
  name: string
  net: string
  status?: { abbrev?: string }
  rocket?: { configuration?: { name?: string; full_name?: string } }
  pad?: { name?: string; location?: { name?: string } }
}

function normalize(results: LL2ListResult[]): UpcomingLaunch[] {
  return results.map((r) => {
    // list mode packs the name as "Falcon 9 Block 5 | Starlink Group 10-43".
    const parts = (r.name ?? '').split(' | ')
    const rocketFromName = parts.length > 1 ? parts[0] : undefined
    const mission = parts.length > 1 ? parts.slice(1).join(' | ') : (r.name ?? 'SpaceX launch')
    return {
      id: r.id,
      name: mission,
      rocket:
        r.rocket?.configuration?.full_name ??
        r.rocket?.configuration?.name ??
        rocketFromName ??
        'Falcon 9',
      pad: [r.pad?.name, r.pad?.location?.name].filter(Boolean).join(', '),
      net: r.net,
      status: r.status?.abbrev ?? 'TBD',
    }
  })
}

/** Fetch the next few upcoming SpaceX launches, cache-first. Returns []
 *  on a cold start that's also rate-limited (rare). */
export async function fetchUpcomingLaunches(): Promise<UpcomingLaunch[]> {
  const fresh = readCache(FRESH_MS)
  if (fresh) return fresh

  try {
    const res = await fetch(LL2_URL)
    if (res.ok) {
      const json = (await res.json()) as { results?: LL2ListResult[] }
      const launches = normalize(json.results ?? [])
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), launches }))
      } catch {
        // quota / private mode
      }
      return launches
    }
  } catch {
    // network/CORS error → fall through to stale cache
  }
  return readCache(FALLBACK_MS) ?? []
}
