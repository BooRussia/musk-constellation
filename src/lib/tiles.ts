// ============================================
// Web-Mercator XYZ map tiles — providers + math
// ============================================
// Powers the <DetailTiles> mosaic layer: as the camera drops toward the
// surface we stream standard slippy-map tiles (the same {z}/{x}/{y} scheme
// Google Maps / Leaflet use) and drape them on the globe, so you can zoom
// in far past the 8K base texture. Esri ArcGIS Online basemaps are free,
// need no API key, send CORS headers, and serve tiles as {z}/{y}/{x}.

export type TileProvider = 'satellite' | 'street'

export interface ProviderDef {
  id: TileProvider
  label: string
  /** Build the tile URL. Esri uses row/col order: {z}/{y}/{x}. */
  url: (z: number, x: number, y: number) => string
  attribution: string
  maxZoom: number
}

export const TILE_PROVIDERS: Record<TileProvider, ProviderDef> = {
  satellite: {
    id: 'satellite',
    label: 'Satellite',
    url: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    attribution: 'Imagery © Esri · Maxar · Earthstar Geographics',
    maxZoom: 19,
  },
  street: {
    id: 'street',
    label: 'Street',
    url: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`,
    attribution: 'Map © Esri · HERE · Garmin · OpenStreetMap contributors',
    maxZoom: 19,
  },
}

export const TILE_PROVIDER_ORDER: TileProvider[] = ['satellite', 'street']

/** Scene units → kilometres (EARTH_RADIUS = 5 units = 6371 km). */
export const KM_PER_UNIT = 6371 / 5
/** Earth circumference at the equator, km. */
export const EARTH_CIRC_KM = 40075

// --- Slippy-map tile <-> lon/lat conversions (Web Mercator) ---

export function lon2tileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z)
}

export function lat2tileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z)
}

export function tileX2lon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180
}

export function tileY2lat(y: number, z: number): number {
  const n = 2 ** z
  const t = Math.PI * (1 - (2 * y) / n)
  return (Math.atan(Math.sinh(t)) * 180) / Math.PI
}
