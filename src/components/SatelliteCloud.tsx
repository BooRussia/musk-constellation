import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { propagate, gstime, eciToEcf, type SatRec } from 'satellite.js'
import type { SatelliteEntry, ConstellationKey } from '../lib/tle'

// ============================================
// Satellite cloud — instanced glow points
// ============================================
// Renders thousands of satellites as additive glow sprites at their
// real altitudes (~550 km Starlink Shell 1, ~1200 km OneWeb) above
// our scene's Earth (radius 5 = 6371 km IRL).
//
// Per frame:
//   1. Compute Greenwich Mean Sidereal Time (GMST) for the current
//      JavaScript Date.
//   2. For each satellite, propagate() returns ECI (Earth-Centered
//      Inertial) coordinates as kilometers.
//   3. Convert ECI → ECF using GMST so we rotate with Earth.
//   4. Scale by EARTH_RADIUS_KM_TO_SCENE and write into a
//      BufferGeometry position array.
//
// We propagate ALL sats every frame — at 8,500 sats and ~5μs per
// SGP4 call, that's ~42ms which would tank framerate. So we throttle:
// each frame propagates 1/N of the cloud, cycling through the array
// over ~250ms. Subjectively imperceptible since sats move slowly
// at our zoom level.

const EARTH_RADIUS_KM = 6371
// Must match EARTH_RADIUS in EarthScene.tsx exactly.
const EARTH_RADIUS_SCENE = 5
const KM_TO_SCENE = EARTH_RADIUS_SCENE / EARTH_RADIUS_KM

// Brand colors per constellation. Starlink cool blue-white,
// OneWeb warm gold. Toned down from the previous near-pure values
// so additive blending doesn't saturate to white when 50 sats stack
// in the same screen-pixel region. Each individual sat reads as
// a clean tinted dot; clusters glow without bleaching out.
const CONSTELLATION_COLOR: Record<ConstellationKey, THREE.Color> = {
  starlink: new THREE.Color('#7ab8ff'),
  oneweb: new THREE.Color('#ffa838'),
}

// How many sats to propagate per frame. With 60fps that's 16ms/frame
// — we want sat propagation to take <4ms. 1/16 of the cloud per frame
// → all sats refreshed every ~250ms at 60fps. Plenty for visual
// smoothness given how slowly sats move in our viewport.
const PROPAGATE_FRACTION = 1 / 16

interface Props {
  satellites: SatelliteEntry[]
  /** When set, only sats in this set render. undefined = render all. */
  enabledConstellations?: Set<ConstellationKey>
  /** When set, this sat is highlighted (larger + brighter). */
  highlightedNoradId?: number | null
}

export default function SatelliteCloud({
  satellites,
  enabledConstellations,
  highlightedNoradId = null,
}: Props) {
  const visibleSats = useMemo(() => {
    if (!enabledConstellations) return satellites
    return satellites.filter(s => enabledConstellations.has(s.constellation))
  }, [satellites, enabledConstellations])

  const count = visibleSats.length

  // Allocate buffers once per (count, highlight) tuple so React knows
  // when to re-mount the geometry. Color/size are filled here at
  // creation time — the per-frame useFrame only writes to positions.
  // This avoids the react-hooks/immutability lint complaint about
  // mutating useMemo results in effects.
  const buffers = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const sat = visibleSats[i]
      const c = CONSTELLATION_COLOR[sat.constellation]
      const isHighlight = sat.noradId === highlightedNoradId
      colors[i * 3 + 0] = isHighlight ? 1 : c.r
      colors[i * 3 + 1] = isHighlight ? 0.6 : c.g
      colors[i * 3 + 2] = isHighlight ? 0.2 : c.b
      // Sized so a typical sat is ~4-5 screen pixels at default zoom
      // — readable as an individual dot, doesn't bleed into neighbors.
      sizes[i] = isHighlight ? 4.5 : 1.4
    }
    return { positions, colors, sizes }
  }, [visibleSats, count, highlightedNoradId])
  const { positions, colors, sizes } = buffers

  const geometryRef = useRef<THREE.BufferGeometry>(null)
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  // Stable Three vector instances reused per frame.
  const tmpVec = useRef(new THREE.Vector3())
  // Frame counter to slice which sats get propagated this tick.
  const frameNumRef = useRef(0)

  // Propagate every sat once on mount so the initial frame isn't a
  // pile of (0,0,0) points clustered at Earth's center.
  useEffect(() => {
    if (count === 0) return
    const now = new Date()
    const gmst = gstime(now)
    for (let i = 0; i < count; i++) {
      writePosition(visibleSats[i].satrec, now, gmst, positions, i, tmpVec.current)
    }
    if (geometryRef.current) {
      const posAttr = geometryRef.current.getAttribute('position') as THREE.BufferAttribute
      posAttr.needsUpdate = true
    }
  }, [visibleSats, count, positions])

  useFrame(() => {
    if (count === 0) return
    const now = new Date()
    const gmst = gstime(now)

    // Round-robin through the sat array — propagate one slice per
    // frame. Over ~16 frames every sat is refreshed.
    const sliceSize = Math.max(1, Math.ceil(count * PROPAGATE_FRACTION))
    const startIdx = (frameNumRef.current * sliceSize) % count
    const endIdx = Math.min(startIdx + sliceSize, count)
    for (let i = startIdx; i < endIdx; i++) {
      writePosition(visibleSats[i].satrec, now, gmst, positions, i, tmpVec.current)
    }
    frameNumRef.current++

    if (geometryRef.current) {
      const posAttr = geometryRef.current.getAttribute('position') as THREE.BufferAttribute
      posAttr.needsUpdate = true
    }
  })

  if (count === 0) return null

  return (
    <points>
      <bufferGeometry ref={geometryRef}>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
        <bufferAttribute
          attach="attributes-color"
          args={[colors, 3]}
        />
        <bufferAttribute
          attach="attributes-size"
          args={[sizes, 1]}
        />
      </bufferGeometry>
      <shaderMaterial
        ref={materialRef}
        vertexShader={SAT_VERT}
        fragmentShader={SAT_FRAG}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

/** SGP4 propagate one sat's position into the buffer. ECI returned
 *  in km → rotate by GMST to ECF (so it spins with Earth) → scale
 *  to scene units. */
function writePosition(
  satrec: SatRec,
  now: Date,
  gmst: number,
  buffer: Float32Array,
  index: number,
  tmp: THREE.Vector3,
): void {
  const pv = propagate(satrec, now)
  if (!pv?.position || typeof pv.position === 'boolean') {
    // Failed propagation — park at origin (will be culled by additive
    // blend at center).
    buffer[index * 3 + 0] = 0
    buffer[index * 3 + 1] = 0
    buffer[index * 3 + 2] = 0
    return
  }
  const ecf = eciToEcf(pv.position, gmst)
  // satellite.js axis convention: x = equator/prime meridian,
  // y = equator/90E, z = north pole. three.js uses y = up. Map
  // ECF (x, y, z) → scene (x, z, -y) so the pole points up.
  tmp.set(ecf.x, ecf.z, -ecf.y).multiplyScalar(KM_TO_SCENE)
  buffer[index * 3 + 0] = tmp.x
  buffer[index * 3 + 1] = tmp.y
  buffer[index * 3 + 2] = tmp.z
}

// ============================================
// Shaders — glow point sprites
// ============================================
// Each satellite renders as a small additive glow that scales with
// distance from camera so far sats still pop visually. Soft edges
// via radial alpha falloff in the fragment shader.

const SAT_VERT = /* glsl */ `
attribute float size;
attribute vec3 color;
varying vec3 vColor;
void main() {
  vColor = color;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPos;
  // Scale point size by inverse depth, clamped so far-away sats
  // don't disappear and close ones don't take over the screen.
  float scale = clamp(60.0 / -mvPos.z, 1.0, 12.0);
  gl_PointSize = size * scale;
}
`

const SAT_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  // Tight radial falloff — bright center with a small subtle halo.
  // The pow exponent is high so each dot reads as a hard pixel
  // rather than a wide glowing blob; clusters still hint at density
  // via additive blending without bleaching to white.
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv) * 2.0;
  if (d > 1.0) discard;
  float alpha = pow(1.0 - d, 4.0) * 0.85;
  gl_FragColor = vec4(vColor, alpha);
}
`
