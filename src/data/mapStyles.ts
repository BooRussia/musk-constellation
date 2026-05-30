// ============================================
// Map styles — swappable Earth skins
// ============================================
// Any image dropped into src/assets/map-styles/ is auto-discovered here
// at build time (Vite glob) and surfaced in the "Map style" dropdown on
// the Starlink view. See that folder's README for the format.

export interface MapStyle {
  id: string
  label: string
  /** Resolved URL of the equirectangular day/albedo map. */
  dayUrl: string
  /**
   * stylized = render the texture faithfully (no procedural ocean, no
   * real-Earth city lights — those assume the real coastlines).
   * realistic (stylized=false) = run the full photoreal pipeline.
   */
  stylized: boolean
}

const BASE = import.meta.env.BASE_URL

/** The built-in photoreal Earth — always the first/default option. */
export const PHOTOREAL_STYLE: MapStyle = {
  id: 'photoreal',
  label: 'Photoreal Earth',
  dayUrl: `${BASE}textures/planets/earth_day_8k.jpg`,
  stylized: false,
}

// Per-file overrides keyed by the base filename (without extension). Use
// `realistic: true` for a dropped-in REAL Earth map that should get the
// full photoreal treatment (animated ocean + city lights), or `label` to
// override the auto-generated name.
const OVERRIDES: Record<string, { label?: string; realistic?: boolean }> = {
  // 'topo-bathy': { label: 'Topographic', realistic: true },
}

/** Auto-discovered stylized maps from src/assets/map-styles/. */
const discovered = import.meta.glob(
  '../assets/map-styles/*.{jpg,jpeg,png,webp}',
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>

function prettify(name: string): string {
  return name
    .replace(/^\d+[-_]/, '') // strip a leading sort-order prefix like "01-"
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

const droppedStyles: MapStyle[] = Object.entries(discovered)
  .map(([path, url]) => {
    const file = path.split('/').pop()!.replace(/\.[^.]+$/, '')
    const ov = OVERRIDES[file] ?? {}
    return {
      id: file,
      label: ov.label ?? prettify(file),
      dayUrl: url,
      stylized: !ov.realistic,
    }
  })
  .sort((a, b) => a.label.localeCompare(b.label))

/** All selectable styles — photoreal first, then dropped-in styles A→Z. */
export const MAP_STYLES: MapStyle[] = [PHOTOREAL_STYLE, ...droppedStyles]

export function getMapStyle(id: string | undefined): MapStyle {
  return MAP_STYLES.find((s) => s.id === id) ?? PHOTOREAL_STYLE
}
