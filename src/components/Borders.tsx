import { useEffect, useState } from 'react'
import * as THREE from 'three'

// ============================================
// BORDERS — country + US-state boundary overlay
// ============================================
// Glowing line overlay drawn just above the Earth surface, so it sits on
// top of WHATEVER map is showing (photoreal, dark Map, or any stylized
// skin). The line data (world country outlines + US state borders) is
// pre-baked into src/data/geo/borders.json by scripts/build-borders.mjs
// and lazy-loaded here only when the overlay is toggled on.

const EARTH_RADIUS = 5
// Float a hair above the surface so the lines aren't z-fighting and read
// as a clean overlay; still below the satellite shell.
const BORDER_RADIUS = EARTH_RADIUS * 1.004
const DEG2RAD = Math.PI / 180

/** lat/lon → scene position, matching the Earth texture + satellite frame
 *  (ECEF x,y,z → scene x, z, -y) so the borders line up with the map. */
function latLonToVec(lat: number, lon: number, r: number, out: THREE.Vector3) {
  const phi = lat * DEG2RAD
  const lam = lon * DEG2RAD
  const cp = Math.cos(phi)
  out.set(cp * Math.cos(lam), Math.sin(phi), -cp * Math.sin(lam)).multiplyScalar(r)
}

function buildGeometry(lines: [number, number][][]): THREE.BufferGeometry {
  const positions: number[] = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const [lon1, lat1] = line[i]
      const [lon2, lat2] = line[i + 1]
      const dLat = lat2 - lat1
      const dLon = lon2 - lon1
      // Subdivide long edges so the line follows the sphere's curve
      // (a straight chord across many degrees would cut through the globe).
      const ang = Math.hypot(dLat, dLon * Math.cos((lat1 + lat2) * 0.5 * DEG2RAD))
      const segs = Math.max(1, Math.min(24, Math.ceil(ang / 2)))
      for (let s = 0; s < segs; s++) {
        const t1 = s / segs
        const t2 = (s + 1) / segs
        latLonToVec(lat1 + dLat * t1, lon1 + dLon * t1, BORDER_RADIUS, a)
        latLonToVec(lat1 + dLat * t2, lon1 + dLon * t2, BORDER_RADIUS, b)
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
      }
    }
  }
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geom
}

export default function Borders() {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null)

  useEffect(() => {
    let cancelled = false
    let built: THREE.BufferGeometry | null = null
    import('../data/geo/borders.json').then((mod) => {
      if (cancelled) return
      const data = (mod.default ?? mod) as { lines: [number, number][][] }
      built = buildGeometry(data.lines)
      setGeometry(built)
    })
    return () => {
      cancelled = true
      built?.dispose()
    }
  }, [])

  if (!geometry) return null
  return (
    <lineSegments geometry={geometry} renderOrder={2}>
      <lineBasicMaterial
        color="#86dcff"
        transparent
        opacity={0.6}
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </lineSegments>
  )
}
