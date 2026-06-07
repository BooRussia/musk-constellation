// ============================================
// build-tle-snapshot.mjs — bake a fallback TLE snapshot
// ============================================
// Downloads current TLEs for every tracked constellation (+ the ISS) from
// CelesTrak and writes them to public/data/tle/<key>.txt. The app serves
// these same-origin and falls back to them when CelesTrak refuses a live
// download (its per-IP "GP data has not updated" 403 throttle), so the globe
// is never empty on a cold start. Re-run periodically to keep it current:
//   npm run build-tle
//
// Starlink uses the supplemental endpoint (separate throttle bucket; the
// GROUP endpoint 403s on repeat pulls within 2h). Everything else uses GROUP.

import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'tle')

// key (app ConstellationKey) → CelesTrak source URL.
const SOURCES = {
  starlink: 'https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=starlink&FORMAT=tle',
  kuiper: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=kuiper&FORMAT=tle',
  oneweb: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=oneweb&FORMAT=tle',
  iridium: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=iridium-NEXT&FORMAT=tle',
  globalstar: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=globalstar&FORMAT=tle',
  orbcomm: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=orbcomm&FORMAT=tle',
  ses: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=ses&FORMAT=tle',
  intelsat: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=intelsat&FORMAT=tle',
  telesat: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=telesat&FORMAT=tle',
  iss: 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle',
}

function looksValid(text) {
  return text && text.includes('\n1 ') && !text.includes('GP data has not updated')
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  let ok = 0
  for (const [key, url] of Object.entries(SOURCES)) {
    try {
      const res = await fetch(url)
      const text = await res.text()
      if (!res.ok || !looksValid(text)) {
        console.warn(`! ${key}: HTTP ${res.status} / invalid (${text.slice(0, 50).trim()}) — keeping existing snapshot`)
        continue
      }
      await writeFile(join(OUT_DIR, `${key}.txt`), text)
      const sats = (text.match(/\n1 /g) || []).length + (text.startsWith('1 ') ? 1 : 0)
      console.log(`✓ ${key}: ${sats} objects`)
      ok++
    } catch (err) {
      console.warn(`! ${key}: ${err.message} — keeping existing snapshot`)
    }
  }
  console.log(`\nDone. ${ok}/${Object.keys(SOURCES).length} groups refreshed → ${OUT_DIR}`)
}

main()
