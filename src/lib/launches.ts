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

// ============================================
// Detailed next launch (pad coords, window, weather, webcast)
// ============================================

export interface DetailedLaunch {
  id: string
  mission: string
  rocket: string
  /** No-earlier-than launch time, ISO. */
  net: string
  windowStart?: string
  windowEnd?: string
  /** Weather "go" probability % (null if LL2 doesn't have it). */
  probability: number | null
  /** Free-text weather concerns, if any. */
  weather?: string
  status: string
  /** Best webcast URL to open externally (highest-priority stream). */
  webcastUrl?: string
  /** YouTube embed URL, if any of the webcasts is an embeddable YT link. */
  webcastEmbed?: string
  /** Human label for the external-link button ("YouTube" / "X" / "stream"). */
  webcastPlatform?: string
  /** Target orbit abbreviation (LEO / SSO / GTO …), if LL2 has it. */
  orbit?: string
  pad?: { name: string; lat: number; lon: number; location: string }
}

interface LL2DetailedResult {
  id: string
  name?: string
  net: string
  window_start?: string
  window_end?: string
  probability?: number | null
  weather_concerns?: string | null
  status?: { abbrev?: string }
  rocket?: { configuration?: { name?: string; full_name?: string } }
  pad?: { name?: string; latitude?: string | number; longitude?: string | number; location?: { name?: string } }
  mission?: { orbit?: { abbrev?: string; name?: string } | null }
  vidURLs?: Array<{ url?: string; priority?: number }>
}

const LL2_DETAIL_URL =
  'https://ll.thespacedevs.com/2.2.0/launch/upcoming/' +
  '?limit=1&mode=detailed&hide_recent_previous=true&lsp__name=SpaceX'
const DETAIL_CACHE_KEY = 'mc.launch.detail.v1'
const DETAIL_FRESH_MS = 15 * 60 * 1000

/** Turn a YouTube watch/short URL into an embed URL (or undefined). */
export function toYouTubeEmbed(url?: string): string | undefined {
  if (!url) return undefined
  const m =
    url.match(/[?&]v=([\w-]{11})/) ||
    url.match(/youtu\.be\/([\w-]{11})/) ||
    url.match(/youtube\.com\/(?:embed|live)\/([\w-]{11})/)
  return m ? `https://www.youtube.com/embed/${m[1]}` : undefined
}

function platformOf(url?: string): string {
  if (!url) return 'stream'
  if (/youtube\.com|youtu\.be/.test(url)) return 'YouTube'
  if (/(?:twitter|x)\.com/.test(url)) return 'X'
  if (/spacex\.com/.test(url)) return 'SpaceX'
  return 'stream'
}

function normalizeDetailed(r: LL2DetailedResult): DetailedLaunch {
  const parts = (r.name ?? '').split(' | ')
  const rocketFromName = parts.length > 1 ? parts[0] : undefined
  const mission = parts.length > 1 ? parts.slice(1).join(' | ') : (r.name ?? 'SpaceX launch')
  const urls = [...(r.vidURLs ?? [])].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
  const webcast = urls[0]?.url
  // Prefer ANY embeddable YouTube link for the in-app player, even if it's
  // not the highest-priority url (SpaceX's top link is often X, which can't
  // be embedded).
  const webcastEmbed = urls.map((v) => toYouTubeEmbed(v.url)).find(Boolean)
  const lat = r.pad?.latitude != null ? Number(r.pad.latitude) : NaN
  const lon = r.pad?.longitude != null ? Number(r.pad.longitude) : NaN
  return {
    id: r.id,
    mission,
    rocket: r.rocket?.configuration?.full_name ?? r.rocket?.configuration?.name ?? rocketFromName ?? 'Falcon 9',
    net: r.net,
    windowStart: r.window_start,
    windowEnd: r.window_end,
    probability: typeof r.probability === 'number' && r.probability >= 0 ? r.probability : null,
    weather: r.weather_concerns ?? undefined,
    status: r.status?.abbrev ?? 'TBD',
    webcastUrl: webcast,
    webcastEmbed,
    webcastPlatform: platformOf(webcast),
    orbit: r.mission?.orbit?.abbrev ?? undefined,
    pad:
      Number.isFinite(lat) && Number.isFinite(lon)
        ? {
            name: r.pad?.name ?? 'Launch pad',
            lat,
            lon,
            location: r.pad?.location?.name ?? '',
          }
        : undefined,
  }
}

/** Fetch the next SpaceX launch with full detail, cache-first. */
export async function fetchNextLaunchDetailed(): Promise<DetailedLaunch | null> {
  try {
    const raw = localStorage.getItem(DETAIL_CACHE_KEY)
    if (raw) {
      const c = JSON.parse(raw) as { fetchedAt: number; launch: DetailedLaunch }
      if (Date.now() - c.fetchedAt < DETAIL_FRESH_MS) return c.launch
    }
  } catch {
    // ignore
  }
  try {
    const res = await fetch(LL2_DETAIL_URL)
    if (res.ok) {
      const json = (await res.json()) as { results?: LL2DetailedResult[] }
      const first = json.results?.[0]
      if (first) {
        const launch = normalizeDetailed(first)
        try {
          localStorage.setItem(DETAIL_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), launch }))
        } catch {
          // quota
        }
        return launch
      }
    }
  } catch {
    // fall through to stale cache
  }
  try {
    const raw = localStorage.getItem(DETAIL_CACHE_KEY)
    if (raw) return (JSON.parse(raw) as { launch: DetailedLaunch }).launch
  } catch {
    // ignore
  }
  return null
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
