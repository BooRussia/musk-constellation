// Static past-SpaceX-launch dataset, baked at build time by
// scripts/build-launches.mjs (see that file for the data source + shape).
// Lazy-loaded so the JSON only ships when the replay feature is opened.

export interface PastLaunchEvent {
  /** Display label, e.g. "MECO", "Starlink Deployment". */
  label: string
  /** Seconds from liftoff (T+). */
  t: number
}

export interface PastLaunch {
  id: string
  mission: string
  rocket: string
  /** Launch time, ISO UTC. */
  net: string
  pad: { name: string; lat: number; lon: number; location: string }
  /** Orbit category abbrev: LEO / SSO / GTO / MEO / Sub / N/A. */
  orbit: string
  missionType: string
  webcastUrl?: string
  /** YouTube embed URL when an embeddable stream exists (preferred for in-app player). */
  webcastEmbed?: string
  /**
   * Seconds into the YouTube VOD where T+0 (liftoff) occurs.
   * When omitted, the mini-player estimates from video duration vs mission length.
   */
  webcastLiftoffOffsetSec?: number
  landing: {
    downrangeKm: number | null
    location: string
    success: boolean | null
    type: string
  } | null
  /** Real flight events when available (recent launches); [] for older. */
  events: PastLaunchEvent[]
  hasRealTimeline: boolean
}

let cache: PastLaunch[] | null = null

/** Load the baked dataset (dynamic import → its own chunk). */
export async function loadPastLaunches(): Promise<PastLaunch[]> {
  if (cache) return cache
  const mod = await import('../data/pastLaunches.json')
  cache = mod.default as PastLaunch[]
  return cache
}
