/**
 * Geographic labels for the 3D globe — continents, oceans/seas, and
 * major cities. Positioned by lat/lon and shown with zoom-based
 * level-of-detail (tier) so the globe reads like Apple Maps: a few
 * big labels when zoomed out, more cities as you zoom in.
 *
 * tier meaning:
 *   continents / oceans: 0 = always-on anchor labels
 *   cities: 1 = global megacity, 2 = large city, 3 = notable city
 */

export type GeoLabelKind = 'continent' | 'ocean' | 'city'

export interface GeoLabel {
  name: string
  /** Latitude in degrees, north positive. */
  lat: number
  /** Longitude in degrees, east positive. */
  lon: number
  kind: GeoLabelKind
  tier: number
}

export const GEO_LABELS: GeoLabel[] = [
  // ── Continents / regions (tier 0 — always visible) ─────────────
  { name: 'NORTH AMERICA', lat: 44, lon: -101, kind: 'continent', tier: 0 },
  { name: 'SOUTH AMERICA', lat: -14, lon: -60, kind: 'continent', tier: 0 },
  { name: 'EUROPE', lat: 50, lon: 15, kind: 'continent', tier: 0 },
  { name: 'AFRICA', lat: 3, lon: 22, kind: 'continent', tier: 0 },
  { name: 'ASIA', lat: 48, lon: 90, kind: 'continent', tier: 0 },
  { name: 'AUSTRALIA', lat: -25, lon: 134, kind: 'continent', tier: 0 },
  { name: 'ANTARCTICA', lat: -82, lon: 0, kind: 'continent', tier: 0 },

  // ── Oceans & major seas (tier 0) ───────────────────────────────
  { name: 'Pacific Ocean', lat: 0, lon: -150, kind: 'ocean', tier: 0 },
  { name: 'North Pacific Ocean', lat: 30, lon: 175, kind: 'ocean', tier: 0 },
  { name: 'Atlantic Ocean', lat: 5, lon: -30, kind: 'ocean', tier: 0 },
  { name: 'North Atlantic Ocean', lat: 38, lon: -45, kind: 'ocean', tier: 0 },
  { name: 'Indian Ocean', lat: -25, lon: 78, kind: 'ocean', tier: 0 },
  { name: 'Southern Ocean', lat: -60, lon: 120, kind: 'ocean', tier: 0 },
  { name: 'Arctic Ocean', lat: 84, lon: 0, kind: 'ocean', tier: 0 },
  { name: 'Mediterranean Sea', lat: 35, lon: 18, kind: 'ocean', tier: 1 },
  { name: 'Caribbean Sea', lat: 15, lon: -75, kind: 'ocean', tier: 1 },
  { name: 'Arabian Sea', lat: 14, lon: 62, kind: 'ocean', tier: 1 },
  { name: 'Bay of Bengal', lat: 13, lon: 88, kind: 'ocean', tier: 1 },
  { name: 'South China Sea', lat: 13, lon: 114, kind: 'ocean', tier: 1 },
  { name: 'Philippine Sea', lat: 18, lon: 132, kind: 'ocean', tier: 1 },
  { name: 'Gulf of Mexico', lat: 25, lon: -90, kind: 'ocean', tier: 1 },

  // ── Tier-1 global megacities ───────────────────────────────────
  { name: 'New York', lat: 40.71, lon: -74.01, kind: 'city', tier: 1 },
  { name: 'Los Angeles', lat: 34.05, lon: -118.24, kind: 'city', tier: 1 },
  { name: 'Mexico City', lat: 19.43, lon: -99.13, kind: 'city', tier: 1 },
  { name: 'São Paulo', lat: -23.55, lon: -46.63, kind: 'city', tier: 1 },
  { name: 'London', lat: 51.51, lon: -0.13, kind: 'city', tier: 1 },
  { name: 'Paris', lat: 48.86, lon: 2.35, kind: 'city', tier: 1 },
  { name: 'Moscow', lat: 55.76, lon: 37.62, kind: 'city', tier: 1 },
  { name: 'Cairo', lat: 30.04, lon: 31.24, kind: 'city', tier: 1 },
  { name: 'Lagos', lat: 6.52, lon: 3.38, kind: 'city', tier: 1 },
  { name: 'Mumbai', lat: 19.08, lon: 72.88, kind: 'city', tier: 1 },
  { name: 'Delhi', lat: 28.61, lon: 77.21, kind: 'city', tier: 1 },
  { name: 'Beijing', lat: 39.90, lon: 116.41, kind: 'city', tier: 1 },
  { name: 'Shanghai', lat: 31.23, lon: 121.47, kind: 'city', tier: 1 },
  { name: 'Tokyo', lat: 35.68, lon: 139.69, kind: 'city', tier: 1 },
  { name: 'Jakarta', lat: -6.21, lon: 106.85, kind: 'city', tier: 1 },
  { name: 'Sydney', lat: -33.87, lon: 151.21, kind: 'city', tier: 1 },

  // ── Tier-2 large cities ────────────────────────────────────────
  { name: 'Chicago', lat: 41.88, lon: -87.63, kind: 'city', tier: 2 },
  { name: 'Toronto', lat: 43.65, lon: -79.38, kind: 'city', tier: 2 },
  { name: 'Houston', lat: 29.76, lon: -95.37, kind: 'city', tier: 2 },
  { name: 'Miami', lat: 25.76, lon: -80.19, kind: 'city', tier: 2 },
  { name: 'Bogotá', lat: 4.71, lon: -74.07, kind: 'city', tier: 2 },
  { name: 'Lima', lat: -12.05, lon: -77.04, kind: 'city', tier: 2 },
  { name: 'Buenos Aires', lat: -34.60, lon: -58.38, kind: 'city', tier: 2 },
  { name: 'Rio de Janeiro', lat: -22.91, lon: -43.17, kind: 'city', tier: 2 },
  { name: 'Madrid', lat: 40.42, lon: -3.70, kind: 'city', tier: 2 },
  { name: 'Berlin', lat: 52.52, lon: 13.40, kind: 'city', tier: 2 },
  { name: 'Rome', lat: 41.90, lon: 12.50, kind: 'city', tier: 2 },
  { name: 'Istanbul', lat: 41.01, lon: 28.98, kind: 'city', tier: 2 },
  { name: 'Johannesburg', lat: -26.20, lon: 28.05, kind: 'city', tier: 2 },
  { name: 'Nairobi', lat: -1.29, lon: 36.82, kind: 'city', tier: 2 },
  { name: 'Dubai', lat: 25.20, lon: 55.27, kind: 'city', tier: 2 },
  { name: 'Tehran', lat: 35.69, lon: 51.39, kind: 'city', tier: 2 },
  { name: 'Karachi', lat: 24.86, lon: 67.00, kind: 'city', tier: 2 },
  { name: 'Bangkok', lat: 13.76, lon: 100.50, kind: 'city', tier: 2 },
  { name: 'Singapore', lat: 1.35, lon: 103.82, kind: 'city', tier: 2 },
  { name: 'Hong Kong', lat: 22.32, lon: 114.17, kind: 'city', tier: 2 },
  { name: 'Seoul', lat: 37.57, lon: 126.98, kind: 'city', tier: 2 },
  { name: 'Manila', lat: 14.60, lon: 120.98, kind: 'city', tier: 2 },
  { name: 'Melbourne', lat: -37.81, lon: 144.96, kind: 'city', tier: 2 },

  // ── Tier-3 notable cities ──────────────────────────────────────
  { name: 'San Francisco', lat: 37.77, lon: -122.42, kind: 'city', tier: 3 },
  { name: 'Seattle', lat: 47.61, lon: -122.33, kind: 'city', tier: 3 },
  { name: 'Vancouver', lat: 49.28, lon: -123.12, kind: 'city', tier: 3 },
  { name: 'Denver', lat: 39.74, lon: -104.99, kind: 'city', tier: 3 },
  { name: 'Boston', lat: 42.36, lon: -71.06, kind: 'city', tier: 3 },
  { name: 'Santiago', lat: -33.45, lon: -70.67, kind: 'city', tier: 3 },
  { name: 'Lisbon', lat: 38.72, lon: -9.14, kind: 'city', tier: 3 },
  { name: 'Amsterdam', lat: 52.37, lon: 4.90, kind: 'city', tier: 3 },
  { name: 'Stockholm', lat: 59.33, lon: 18.07, kind: 'city', tier: 3 },
  { name: 'Athens', lat: 37.98, lon: 23.73, kind: 'city', tier: 3 },
  { name: 'Cape Town', lat: -33.92, lon: 18.42, kind: 'city', tier: 3 },
  { name: 'Casablanca', lat: 33.57, lon: -7.59, kind: 'city', tier: 3 },
  { name: 'Riyadh', lat: 24.71, lon: 46.68, kind: 'city', tier: 3 },
  { name: 'Chongqing', lat: 29.43, lon: 106.91, kind: 'city', tier: 3 },
  { name: 'Ho Chi Minh City', lat: 10.82, lon: 106.63, kind: 'city', tier: 3 },
  { name: 'Kuala Lumpur', lat: 3.14, lon: 101.69, kind: 'city', tier: 3 },
  { name: 'Auckland', lat: -36.85, lon: 174.76, kind: 'city', tier: 3 },
  { name: 'Honolulu', lat: 21.31, lon: -157.86, kind: 'city', tier: 3 },
]
