import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { destPoint } from '../lib/trajectory'

// A translucent trajectory "cone" laid on the globe at the launch pad, fanning
// out in the launch azimuth — the rocket's general heading, the way map
// trackers show "Launching South / East / …". Its great-circle size scales
// with camera distance so it reads big at the default tracking framing and
// shrinks as you zoom in, staying roughly constant on screen.
//
// The fan is TESSELLATED (radial × angular grid) so every vertex sits on the
// globe shell — a flat triangle fan would chord through the sphere and let the
// Earth poke through it. renderOrder sits above the detail-tile mosaic so it
// stays visible when you zoom in and tiles stream over the base globe.

const EARTH_RADIUS = 5
const SURFACE = EARTH_RADIUS * 1.002 // just above the detail tiles (×1.0008)
const RAD = Math.PI / 180
const RADIAL = 6 // rings from apex → rim
const ANG = 28 // spokes across the fan width
const FILL_VERTS = (RADIAL + 1) * (ANG + 1)
const LINE_VERTS = ANG + 2 // apex + outer ring (closed by lineLoop)

// Arc length (great-circle degrees) ≈ SIZE_K × camera distance keeps the
// on-screen size constant (screen size ∝ arc / distance).
const SIZE_K = 1.7
const ARC_MIN = 8
const ARC_MAX = 55
const WIDTH_RATIO = 0.7 // half-width (bearing) as a fraction of arc length

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

const _t = new THREE.Vector3()
function toScene(lat: number, lon: number, out: THREE.Vector3): THREE.Vector3 {
  const phi = lat * RAD
  const lam = lon * RAD
  const cp = Math.cos(phi)
  return out.set(cp * Math.cos(lam), Math.sin(phi), -cp * Math.sin(lam)).multiplyScalar(SURFACE)
}

/** Fill the tessellated fan (radial×angular grid) + its boundary outline. */
function writeCone(
  fill: Float32Array,
  line: Float32Array,
  lat: number,
  lon: number,
  az: number,
  arc: number,
  half: number,
): void {
  let p = 0
  for (let i = 0; i <= RADIAL; i++) {
    const arcI = arc * (i / RADIAL)
    for (let j = 0; j <= ANG; j++) {
      const bearing = az - half + (j / ANG) * (half * 2)
      // arcI === 0 → destPoint returns the pad itself, so the apex ring
      // collapses to a point (degenerate triangles, harmless).
      const d = destPoint(lat, lon, bearing, arcI)
      toScene(d.lat, d.lon, _t)
      fill[p++] = _t.x
      fill[p++] = _t.y
      fill[p++] = _t.z
    }
  }
  // Outline: apex + the outer ring, drawn as a line loop (traces both sides
  // + the rim arc).
  toScene(lat, lon, _t)
  line[0] = _t.x
  line[1] = _t.y
  line[2] = _t.z
  const outerBase = RADIAL * (ANG + 1) * 3
  for (let j = 0; j <= ANG; j++) {
    const src = outerBase + j * 3
    const dst = (j + 1) * 3
    line[dst] = fill[src]
    line[dst + 1] = fill[src + 1]
    line[dst + 2] = fill[src + 2]
  }
}

interface Props {
  lat: number
  lon: number
  /** Launch azimuth, degrees clockwise from true north. */
  azimuth: number
  color?: string
}

export default function LaunchCone({ lat, lon, azimuth, color = '#a274ff' }: Props) {
  const fillPos = useMemo(() => new Float32Array(FILL_VERTS * 3), [])
  const linePos = useMemo(() => new Float32Array(LINE_VERTS * 3), [])
  // Grid triangle index (fixed).
  const index = useMemo(() => {
    const a: number[] = []
    for (let i = 0; i < RADIAL; i++) {
      for (let j = 0; j < ANG; j++) {
        const v = i * (ANG + 1) + j
        const b = v + 1
        const c = v + (ANG + 1)
        const d = c + 1
        a.push(v, c, b, b, c, d)
      }
    }
    return new Uint16Array(a)
  }, [])

  const fillRef = useRef<THREE.Mesh>(null)
  const lineRef = useRef<THREE.LineLoop>(null)
  const lastArc = useRef(-1)

  useEffect(() => {
    lastArc.current = -1
  }, [lat, lon, azimuth])

  useFrame(({ camera }) => {
    const fill = fillRef.current
    const line = lineRef.current
    if (!fill || !line) return
    const arc = clamp(camera.position.length() * SIZE_K, ARC_MIN, ARC_MAX)
    if (Math.abs(arc - lastArc.current) < 0.05) return
    lastArc.current = arc
    const fa = fill.geometry.getAttribute('position') as THREE.BufferAttribute
    const la = line.geometry.getAttribute('position') as THREE.BufferAttribute
    writeCone(fa.array as Float32Array, la.array as Float32Array, lat, lon, azimuth, arc, arc * WIDTH_RATIO)
    fa.needsUpdate = true
    la.needsUpdate = true
  })

  return (
    <group>
      <mesh ref={fillRef} renderOrder={5} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[fillPos, 3]} />
          <bufferAttribute attach="index" args={[index, 1]} />
        </bufferGeometry>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.32}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <lineLoop ref={lineRef} renderOrder={6} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[linePos, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} transparent opacity={0.85} depthWrite={false} />
      </lineLoop>
    </group>
  )
}
