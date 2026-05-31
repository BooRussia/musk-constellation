// Pre-processes world country borders (world-atlas 50m, deduplicated via
// topojson.mesh) + US state borders (us-states.json) into one compact
// line-coordinate file the app loads lazily when the Borders overlay is
// toggled on. Run: `node scripts/build-borders.mjs`
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { mesh } from 'topojson-client'

const round = (n) => Math.round(n * 100) / 100 // ~1 km precision — plenty on a globe

// Round + drop points that barely move from the previous one, so the
// file stays small without visibly changing the lines at globe scale.
const MIN_STEP = 0.06 // degrees
function simplify(coords) {
  const out = []
  let px = NaN, py = NaN
  for (const [lon, lat] of coords) {
    const x = round(lon), y = round(lat)
    if (out.length && Math.abs(x - px) < MIN_STEP && Math.abs(y - py) < MIN_STEP) continue
    out.push([x, y])
    px = x
    py = y
  }
  return out
}

// 110m country outlines — coarse enough to stay small but clean on the
// globe. mesh() returns shared edges ONCE (no double-drawn boundaries).
const countries = JSON.parse(
  readFileSync('node_modules/world-atlas/countries-110m.json', 'utf8'),
)
const states = JSON.parse(readFileSync('src/data/geo/us-states.json', 'utf8'))

/** @type {[number, number][][]} */
const lines = []

const countryMesh = mesh(countries, countries.objects.countries)
for (const line of countryMesh.coordinates) {
  const s = simplify(line)
  if (s.length > 1) lines.push(s)
}

// US state borders — polygon rings (some shared edges drawn twice, fine).
for (const f of states.features) {
  const g = f.geometry
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  for (const poly of polys) {
    for (const ring of poly) {
      const s = simplify(ring)
      if (s.length > 1) lines.push(s)
    }
  }
}

mkdirSync('src/data/geo', { recursive: true })
writeFileSync('src/data/geo/borders.json', JSON.stringify({ lines }))

const points = lines.reduce((n, l) => n + l.length, 0)
console.log(`wrote ${lines.length} lines, ${points} points`)
