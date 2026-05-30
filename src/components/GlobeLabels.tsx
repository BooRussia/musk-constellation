import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { GEO_LABELS, type GeoLabel } from '../data/geoLabels'

// ============================================
// GLOBE LABELS — Apple-Maps-style place names
// ============================================
// Continents, oceans, and major cities positioned by lat/lon on the
// globe. Two behaviors managed per-frame via direct DOM mutation (no
// React state churn):
//   1. Level-of-detail: which tiers are visible depends on how far
//      the camera is from the globe — few labels zoomed out, more as
//      you zoom in (like Apple Maps).
//   2. Back-side occlusion: labels on the hemisphere facing away from
//      the camera are hidden, with a soft opacity fade near the limb.

const EARTH_RADIUS = 5
// Place labels a hair above the surface so they're not z-fighting.
const LABEL_RADIUS = EARTH_RADIUS * 1.003

const DEG2RAD = Math.PI / 180

/** Convert lat/lon to the scene-space position, matching the Earth
 *  texture + satellite frame: ECEF (x,y,z) → scene (x, z, -y). */
function latLonToScene(latDeg: number, lonDeg: number, radius: number): THREE.Vector3 {
  const phi = latDeg * DEG2RAD
  const lam = lonDeg * DEG2RAD
  const ex = Math.cos(phi) * Math.cos(lam)
  const ey = Math.cos(phi) * Math.sin(lam)
  const ez = Math.sin(phi)
  return new THREE.Vector3(ex, ez, -ey).multiplyScalar(radius)
}

/** Camera-distance → highest tier of city labels to show. Tuned for
 *  the Earth view's minDistance 6 / maxDistance 48. Continents +
 *  oceans (tier 0) are always on; this gates the city/sea tiers. */
function maxTierForDistance(dist: number): number {
  if (dist > 26) return 0 // far out: continents + major oceans only
  if (dist > 18) return 1 // + megacities + major seas
  if (dist > 11) return 2 // + large cities
  return 3 // close: + notable cities
}

interface LabelEntry {
  data: GeoLabel
  /** Unit surface normal (for occlusion dot product). */
  normal: THREE.Vector3
  /** Scene position of the label. */
  pos: THREE.Vector3
  /** The label's outer DOM node (set by the Html ref callback). */
  el: HTMLDivElement | null
}

export default function GlobeLabels() {
  // Build the static per-label geometry once.
  const entries = useMemo<LabelEntry[]>(
    () =>
      GEO_LABELS.map((data) => {
        const pos = latLonToScene(data.lat, data.lon, LABEL_RADIUS)
        return { data, pos, normal: pos.clone().normalize(), el: null }
      }),
    [],
  )
  const entriesRef = useRef(entries)

  const camDir = useRef(new THREE.Vector3())

  useFrame(({ camera }) => {
    const dist = camera.position.length()
    const maxTier = maxTierForDistance(dist)
    // Direction from globe centre to camera (globe is at origin).
    camDir.current.copy(camera.position).normalize()

    for (const entry of entriesRef.current) {
      const el = entry.el
      if (!el) continue

      // Tier gate (LOD). Continents/oceans are tier 0 (always within
      // any maxTier >= 0); cities/seas appear as you zoom in.
      const tierVisible = entry.data.tier <= maxTier
      if (!tierVisible) {
        if (el.style.display !== 'none') el.style.display = 'none'
        continue
      }

      // Occlusion: front-facing when the surface normal points toward
      // the camera. Small margin so labels fade out before the limb.
      const facing = entry.normal.dot(camDir.current)
      if (facing <= 0.12) {
        if (el.style.display !== 'none') el.style.display = 'none'
        continue
      }

      if (el.style.display === 'none') el.style.display = ''
      // Soft fade as a label approaches the limb (0.12 → 0.30).
      const fade = THREE.MathUtils.clamp((facing - 0.12) / 0.18, 0, 1)
      el.style.opacity = fade.toFixed(2)
    }
  })

  return (
    <group>
      {entries.map((entry, i) => (
        <Html
          key={`${entry.data.name}-${i}`}
          position={entry.pos}
          center
          zIndexRange={[10, 0]}
          // Don't let drei occlude/transform-scale; we manage
          // visibility ourselves and want constant screen-size text.
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
