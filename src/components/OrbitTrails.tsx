import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { propagate, gstime, eciToEcf, type SatRec } from 'satellite.js'
import type { SatelliteEntry } from '../lib/tle'
import { trailColorAt } from '../lib/trailColors'

// ============================================
// ORBIT TRAILS — flight paths for selected satellites
// ============================================
// For each selected sat we sample its SGP4 orbit over the last full
// period (now − period → now) and draw it as a line in the same
// ECEF→scene frame as the Earth + satellite cloud. A per-vertex
// progress attribute fades the line from transparent at the tail
// (where the sat was a full orbit ago) to bright at the head (the
// current position) — a comet trail showing how far it's travelled
// and where it is now. The path is the actual ground-relative track
// (it precesses, because the scene is Earth-fixed and Earth rotates
// under the orbit), so overlapping multi-select trails reveal how
// different sats' orbits cross.

const EARTH_RADIUS_KM = 6371
const EARTH_RADIUS_SCENE = 5
const KM_TO_SCENE = EARTH_RADIUS_SCENE / EARTH_RADIUS_KM
const SAMPLES = 180
// Rebuild each trail ~once/sec; the window slides with real time.
const RECOMPUTE_MS = 1000

const TRAIL_VERT = /* glsl */ `
attribute float aProgress;
varying float vProgress;
void main() {
  vProgress = aProgress;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const TRAIL_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vProgress;
void main() {
  // The whole orbit stays faintly visible (0.22 floor) so you can see
  // the complete path, with a bright comet head at the current
  // position (progress = 1) showing where the sat is right now and
  // how far it's travelled.
  float a = 0.22 + 0.78 * pow(vProgress, 1.5);
  gl_FragColor = vec4(uColor, a);
}
`

/** Fill the position + progress arrays for one orbit ending now. */
function sampleOrbit(
  satrec: SatRec,
  periodMin: number,
  positions: Float32Array,
  progress: Float32Array,
): void {
  const nowMs = Date.now()
  const periodMs = Math.max(1, periodMin) * 60000
  for (let i = 0; i < SAMPLES; i++) {
    const f = i / (SAMPLES - 1) // 0 at tail (now-period) → 1 at head (now)
    const t = new Date(nowMs - periodMs * (1 - f))
    const pv = propagate(satrec, t)
    if (!pv?.position || typeof pv.position === 'boolean') {
      positions[i * 3 + 0] = 0
      positions[i * 3 + 1] = 0
      positions[i * 3 + 2] = 0
      progress[i] = 0
      continue
    }
    const ecf = eciToEcf(pv.position, gstime(t))
    positions[i * 3 + 0] = ecf.x * KM_TO_SCENE
    positions[i * 3 + 1] = ecf.z * KM_TO_SCENE
    positions[i * 3 + 2] = -ecf.y * KM_TO_SCENE
    progress[i] = f
  }
}

function OrbitTrail({ entry, color }: { entry: SatelliteEntry; color: string }) {
  const geomRef = useRef<THREE.BufferGeometry>(null)
  const lastBuildRef = useRef(0)

  const periodMin = useMemo(
    () => (entry.satrec.no > 0 ? (2 * Math.PI) / entry.satrec.no : 95),
    [entry],
  )

  // Allocate the buffers + uniform once.
  const { positions, progress, uniforms } = useMemo(() => {
    const positions = new Float32Array(SAMPLES * 3)
    const progress = new Float32Array(SAMPLES)
    sampleOrbit(entry.satrec, periodMin, positions, progress)
    return {
      positions,
      progress,
      uniforms: { uColor: { value: new THREE.Color(color) } },
    }
  }, [entry, periodMin, color])

  useFrame(() => {
    const now = Date.now()
    if (now - lastBuildRef.current < RECOMPUTE_MS) return
    lastBuildRef.current = now
    const geom = geomRef.current
    if (!geom) return
    const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!posAttr) return
    sampleOrbit(entry.satrec, periodMin, posAttr.array as Float32Array, progress)
    posAttr.needsUpdate = true
  })

  return (
    <line>
      <bufferGeometry ref={geomRef}>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aProgress" args={[progress, 1]} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={TRAIL_VERT}
        fragmentShader={TRAIL_FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </line>
  )
}

interface Props {
  /** The selected sats to draw trails for, in selection order (the
   *  index drives the trail color). */
  satellites: SatelliteEntry[]
}

export default function OrbitTrails({ satellites }: Props) {
  return (
    <group>
      {satellites.map((entry, i) => (
        <OrbitTrail key={entry.noradId} entry={entry} color={trailColorAt(i)} />
      ))}
    </group>
  )
}
