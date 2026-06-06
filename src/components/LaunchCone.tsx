import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { destPoint } from '../lib/trajectory'

// A translucent trajectory "cone" laid on the globe at the launch pad, fanning
// out in the launch azimuth — the rocket's general heading, the way map
// trackers show "Launching South / East / …". Its great-circle size scales
// with camera distance so it reads big at the default tracking framing and
// shrinks as you zoom in, staying roughly constant on screen. Hugs the
// surface so the Earth occludes it on the far side automatically.

const EARTH_RADIUS = 5
const SURFACE = EARTH_RADIUS * 1.0015
const RAD = Math.PI / 180
const SEGMENTS = 48
const VERTS = SEGMENTS + 2

// Arc length (great-circle degrees) ≈ SIZE_K × camera distance keeps the
// on-screen size constant (screen size ∝ arc / distance). Clamped so it's
// never a sliver or more than a wide wedge.
const SIZE_K = 1.7
const ARC_MIN = 8
const ARC_MAX = 55
// Half-width of the fan (bearing degrees) as a fraction of its length, so the
// wedge keeps the same shape at every scale.
const WIDTH_RATIO = 0.7

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

const _t = new THREE.Vector3()
function toScene(lat: number, lon: number, r: number, out: THREE.Vector3): THREE.Vector3 {
  const phi = lat * RAD
  const lam = lon * RAD
  const cp = Math.cos(phi)
  return out.set(cp * Math.cos(lam), Math.sin(phi), -cp * Math.sin(lam)).multiplyScalar(r)
}

/** Write the apex + rim of the fan into a flat position buffer. */
function writeCone(
  arr: Float32Array,
  lat: number,
  lon: number,
  az: number,
  arc: number,
  half: number,
): void {
  toScene(lat, lon, SURFACE, _t)
  arr[0] = _t.x
  arr[1] = _t.y
  arr[2] = _t.z
  for (let i = 0; i <= SEGMENTS; i++) {
    const bearing = az - half + (i / SEGMENTS) * (half * 2)
    const d = destPoint(lat, lon, bearing, arc)
    toScene(d.lat, d.lon, SURFACE, _t)
    const o = (i + 1) * 3
    arr[o] = _t.x
    arr[o + 1] = _t.y
    arr[o + 2] = _t.z
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
  // Initial buffers (filled for real each frame from the camera distance).
  const fillPos = useMemo(() => new Float32Array(VERTS * 3), [])
  const linePos = useMemo(() => new Float32Array(VERTS * 3), [])
  // Triangle-fan index: apex (0) + each adjacent pair of rim points.
  const index = useMemo(() => {
    const a: number[] = []
    for (let i = 1; i <= SEGMENTS; i++) a.push(0, i, i + 1)
    return new Uint16Array(a)
  }, [])

  const fillRef = useRef<THREE.Mesh>(null)
  const lineRef = useRef<THREE.LineLoop>(null)
  const lastArc = useRef(-1)

  // Force a rebuild on the next frame when the pad / heading changes.
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
    const arr = fa.array as Float32Array
    writeCone(arr, lat, lon, azimuth, arc, arc * WIDTH_RATIO)
    ;(la.array as Float32Array).set(arr)
    fa.needsUpdate = true
    la.needsUpdate = true
  })

  return (
    <group>
      <mesh ref={fillRef} renderOrder={2} frustumCulled={false}>
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
      <lineLoop ref={lineRef} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[linePos, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} transparent opacity={0.85} depthWrite={false} />
      </lineLoop>
    </group>
  )
}
