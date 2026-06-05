// ============================================
// build-launches.mjs — bake a static past-SpaceX-launch dataset
// ============================================
// Launch Library 2 is rate-limited (~15 req/hr on prod) and the data is
// historical/immutable, so we precompute a small curated dataset at build
// time rather than fetching from the browser. Recent launches (~2024+)
// carry a real event `timeline`; older ones don't and fall back to a
// canonical Falcon-9 profile in the app. We pull the recent rich set from
// the dev mirror (looser limits, all have timelines).
//
// Run: node scripts/build-launches.mjs   (or: npm run build-launches)

import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'src', 'data', 'pastLaunches.json')

const LIMIT = 40
const SRC = `https://lldev.thespacedevs.com/2.2.0/launch/previous/?lsp__name=SpaceX&mode=detailed&limit=${LIMIT}`

/** ISO-8601 duration ("-PT38M" | "P0D" | "PT2M26S" | "PT1H1M34S") → seconds. */
function relTimeToSeconds(s) {
  if (!s) return null
  if (s === 'P0D') return 0
  const sign = s.startsWith('-') ? -1 : 1
  const m = s.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/)
  if (!m) return null
  const [, h, min, sec] = m
  return sign * ((+h || 0) * 3600 + (+min || 0) * 60 + (+sec || 0))
}

function splitName(name = '') {
  const parts = name.split(' | ')
  return parts.length > 1
    ? { rocket: parts[0], mission: parts.slice(1).join(' | ') }
    : { rocket: 'Falcon 9', mission: name }
}

function normalize(r) {
  const { rocket: rocketFromName, mission } = splitName(r.name)
  const lat = r.pad?.latitude != null ? Number(r.pad.latitude) : NaN
  const lon = r.pad?.longitude != null ? Number(r.pad.longitude) : NaN
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

  // In-flight events only (t >= 0), sorted, de-duped by (label,t).
  const seen = new Set()
  const events = (r.timeline ?? [])
    .map((ev) => ({
      label: ev.type?.abbrev || ev.type?.description || 'Event',
      t: relTimeToSeconds(ev.relative_time),
    }))
    .filter((e) => e.t != null && e.t >= 0)
    .sort((a, b) => a.t - b.t)
    .filter((e) => {
      const k = `${e.label}@${e.t}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })

  const stage = r.rocket?.launcher_stage?.[0]
  const landing = stage?.landing
    ? {
        downrangeKm: stage.landing.downrange_distance ?? null,
        location: stage.landing.location?.name ?? '',
        success: stage.landing.success ?? null,
        type: stage.landing.type?.abbrev ?? '',
      }
    : null

  const webcast = [...(r.vidURLs ?? [])].sort(
    (a, b) => (a.priority ?? 99) - (b.priority ?? 99),
  )[0]?.url

  return {
    id: r.id,
    mission,
    rocket: r.rocket?.configuration?.full_name ?? r.rocket?.configuration?.name ?? rocketFromName,
    net: r.net,
    pad: {
      name: r.pad?.name ?? 'Launch pad',
      lat,
      lon,
      location: r.pad?.location?.name ?? '',
    },
    orbit: r.mission?.orbit?.abbrev ?? 'LEO',
    missionType: r.mission?.type ?? '',
    webcastUrl: webcast,
    landing,
    events,
    hasRealTimeline: events.length > 0,
  }
}

async function main() {
  console.log(`[build-launches] fetching ${SRC}`)
  const res = await fetch(SRC)
  if (!res.ok) throw new Error(`LL2 returned ${res.status}`)
  const json = await res.json()
  const results = json.results ?? []
  const launches = results.map(normalize).filter(Boolean)
  // Newest first (the API already returns previous launches newest-first).
  await writeFile(OUT, JSON.stringify(launches, null, 2) + '\n')
  const withTimeline = launches.filter((l) => l.hasRealTimeline).length
  console.log(
    `[build-launches] wrote ${launches.length} launches (${withTimeline} with real timelines) → ${OUT}`,
  )
}

main().catch((err) => {
  console.error('[build-launches] failed:', err)
  process.exit(1)
})
