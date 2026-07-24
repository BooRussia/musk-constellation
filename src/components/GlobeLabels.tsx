import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { GEO_LABELS, type GeoLabel } from '../data/geoLabels'

// ============================================
// GLOBE LABELS — Apple-Maps-style place names
// ============================================
// Continents, oceans, countries, and cities positioned by lat/lon.
// LOD + back-face occlusion via direct DOM mutation each frame.

const EARTH_RADIUS = 5
const LABEL_RADIUS = EARTH_RADIUS * 1.003
const DEG2RAD = Math.PI / 180

function latLonToScene(latDeg: number, lonDeg: number, radius: number): THREE.Vector3 {
  const phi = latDeg * DEG2RAD
  const lam = lonDeg * DEG2RAD
  const ex = Math.cos(phi) * Math.cos(lam)
  const ey = Math.cos(phi) * Math.sin(lam)
  const ez = Math.sin(phi)
  return new THREE.Vector3(ex, ez, -ey).multiplyScalar(radius)
}

/** City / sea tier cap from camera distance. */
function maxCityTier(dist: number): number {
  if (dist > 26) return 0
  if (dist > 18) return 1
  if (dist > 11) return 2
  return 3
}

/** Country tier cap — sits between continents and cities. */
function maxCountryTier(dist: number): number {
  if (dist > 24) return 0 // far: continents only
  if (dist > 16) return 1 // major countries
  if (dist > 11) return 2 // regional
  return 3 // denser when close
}

function labelVisible(data: GeoLabel, dist: number, showCountries: boolean): boolean {
  if (data.kind === 'continent') return true
  if (data.kind === 'ocean') return data.tier <= maxCityTier(dist)
  if (data.kind === 'country') {
    if (!showCountries) return false
    return data.tier <= maxCountryTier(dist)
  }
  // cities
  return data.tier <= maxCityTier(dist) && data.tier > 0
}

interface LabelEntry {
  data: GeoLabel
  normal: THREE.Vector3
  pos: THREE.Vector3
  el: HTMLDivElement | null
}

interface Props {
  /** When false, country labels are hidden (continents/cities still follow Place names). */
  showCountries?: boolean
}

export default function GlobeLabels({ showCountries = true }: Props) {
  const entries = useMemo<LabelEntry[]>(
    () =>
      GEO_LABELS.map((data) => {
        const pos = latLonToScene(data.lat, data.lon, LABEL_RADIUS)
        return { data, pos, normal: pos.clone().normalize(), el: null }
      }),
    [],
  )
  const entriesRef = useRef(entries)
  const showCountriesRef = useRef(showCountries)
  showCountriesRef.current = showCountries
  const camDir = useRef(new THREE.Vector3())

  useFrame(({ camera }) => {
    const dist = camera.position.length()
    camDir.current.copy(camera.position).normalize()
    const countriesOn = showCountriesRef.current

    for (const entry of entriesRef.current) {
      const el = entry.el
      if (!el) continue

      if (!labelVisible(entry.data, dist, countriesOn)) {
        if (el.style.display !== 'none') el.style.display = 'none'
        continue
      }

      const facing = entry.normal.dot(camDir.current)
      if (facing <= 0.12) {
        if (el.style.display !== 'none') el.style.display = 'none'
        continue
      }

      if (el.style.display === 'none') el.style.display = ''
      const fade = THREE.MathUtils.clamp((facing - 0.12) / 0.18, 0, 1)
      el.style.opacity = fade.toFixed(2)
    }
  })

  return (
    <group>
      {entries.map((entry, i) => (
        <Html
          key={`${entry.data.kind}-${entry.data.name}-${i}`}
          position={entry.pos}
          center
          zIndexRange={[10, 0]}
          style={{ pointerEvents: 'none' }}
          wrapperClass="globe-label-wrapper"
        >
          <div
            ref={(node) => {
              entry.el = node
              entriesRef.current[i].el = node
            }}
            className={`globe-label globe-label--${entry.data.kind}`}
            style={{ display: 'none' }}
          >
            {entry.data.kind === 'city' && <span className="globe-label-dot" />}
            <span className="globe-label-text">{entry.data.name}</span>
          </div>
        </Html>
      ))}
    </group>
  )
}
