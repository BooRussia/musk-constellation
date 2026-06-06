import { useEffect, useMemo } from 'react'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { destPoint } from '../lib/trajectory'

// A translucent trajectory "cone" laid on the globe at the launch pad,
// fanning out in the launch azimuth — the rocket's general heading, the way
// map trackers show "Launching South / East / …". Hugs the surface so the
// Earth occludes it on the far side automatically.

const EARTH_RADIUS = 5
const SURFACE = EARTH_RADIUS * 1.0015
const RAD = Math.PI / 180

const HALF_ANGLE = 21 // half-width of the fan, degrees of bearing
const ARC_DEG = 22 // how far downrange the fan reaches, degrees of great-circle
const SEGMENTS = 48

function toScene(lat: number, lon: number, r: number): THREE.Vector3 {
  const phi = lat * RAD
  const lam = lon * RAD
  const cp = Math.cos(phi)
  return new THREE.Vector3(cp * Math.cos(lam), Math.sin(phi), -cp * Math.sin(lam)).multiplyScalar(r)
}

interface Props {
  lat: number
  lon: number
  /** Launch azimuth, degrees clockwise from true north. */
  azimuth: number
  color?: string
}

export default function LaunchCone({ lat, lon, azimuth, color = '#9b5cff' }: Props) {
  const apex = useMemo(() => toScene(lat, lon, SURFACE), [lat, lon])

  // Rim points of the fan, narrow→wide downrange from the pad.
  const rim = useMemo(() => {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= SEGMENTS; i++) {
      const bearing = azimuth - HALF_ANGLE + (i / SEGMENTS) * (HALF_ANGLE * 2)
      const d = destPoint(lat, lon, bearing, ARC_DEG)
      pts.push(toScene(d.lat, d.lon, SURFACE))
    }
    return pts
  }, [lat, lon, azimuth])

  // Filled fan geometry: apex + the rim arc, as a triangle fan.
  const geometry = useMemo(() => {
    const positions: number[] = [apex.x, apex.y, apex.z]
    for (const p of rim) positions.push(p.x, p.y, p.z)
    const indices: number[] = []
    for (let i = 1; i <= SEGMENTS; i++) indices.push(0, i, i + 1)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    g.setIndex(indices)
    g.computeVertexNormals()
    return g
  }, [apex, rim])

  useEffect(() => () => geometry.dispose(), [geometry])

  // Crisp boundary: apex → along the rim arc → back to apex (two sides + arc).
  const outline = useMemo(
    () => [apex, ...rim, apex] as THREE.Vector3[],
    [apex, rim],
  )

  return (
    <group>
      <mesh geometry={geometry} renderOrder={2}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.34}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <Line points={outline} color={color} lineWidth={1.5} transparent opacity={0.75} />
    </group>
  )
}
