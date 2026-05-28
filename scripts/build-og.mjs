// Rasterize scripts/og-image.svg → public/og-image.png at 1200×630
// (the OG canonical size). Re-run any time the SVG source changes:
//   npm run build:og
//
// Why a build step instead of serving the SVG directly: Facebook,
// LinkedIn, and most older crawlers don't render SVG og:image. PNG
// is the safe universal choice.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const here = dirname(fileURLToPath(import.meta.url))
const svgPath = resolve(here, 'og-image.svg')
const outPath = resolve(here, '..', 'public', 'og-image.png')

const svg = readFileSync(svgPath, 'utf8')
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1200 },
  font: { loadSystemFonts: true },
})
const pngBuffer = resvg.render().asPng()
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, pngBuffer)
const kb = (pngBuffer.length / 1024).toFixed(1)
console.log(`og-image.png  ${pngBuffer.length} bytes (${kb} KB)  →  ${outPath}`)
