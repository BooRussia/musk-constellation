import { useMemo } from 'react'
import * as THREE from 'three'

// ============================================
// GRATICULE — lat/lon grid overlay
// ============================================
// A procedural lon/lat reference grid floated just above the Earth, so
// it works on ANY map skin (photoreal, dark Map, or stylized). Lines
// every 15°; meridians stop short of the poles so they don't all burn
// into one bright dot at the convergence.

const EARTH_RADIUS = 5
const GRID_RADIUS = EARTH_RADIUS * 1.0035
const DEG2RAD = Math.PI / 180
const STEP = 15 // degrees between grid lines
const SUB = 4 // degrees per sub-segment (keeps lines hugging the sphere)

function latLonToVec(lat: number, lon: number, out: THREE.Vector3) {
  const phi = lat * DEG2RAD
  const lam = lon * DEG2RAD
  const cp = Math.cos(phi)
  out.set(cp * Math.cos(lam), Math.sin(phi), -cp * Math.sin(lam)).multiplyScalar(GRID_RADIUS)
}

function buildPositions(): Float32Array {
  const pos: number[] = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()

  // Meridians (constant lon). Stop at ±85° so they don't converge to a
  // single bright point at the poles.
  for (let lon = -180; lon < 180; lon += STEP) {
    for (let lat = -85; lat < 85; lat += SUB) {
      latLonToVec(lat, lon, a)
      latLonToVec(Math.min(lat + SUB, 85), lon, b)
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
  }
  // Parallels (constant lat), full 360° (the lon=180→-180 wrap closes it).
  for (let lat = -75; lat <= 75; lat += STEP) {
    for (let lon = -180; lon < 180; lon += SUB) {
      latLonToVec(lat, lon, a)
      latLonToVec(lat, lon + SUB, b)
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
  }
  return new Float32Array(pos)
}

export default function Graticule() {
  const positions = useMemo(() => buildPositions(), [])
  return (
    <lineSegments renderOrder={1}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial
        color="#bfe6ff"
        transparent
        opacity={0.26}
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </lineSegments>
  )
}
