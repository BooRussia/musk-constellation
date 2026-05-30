import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { propagate, gstime, eciToEcf, type SatRec } from 'satellite.js'
import { CONSTELLATIONS } from '../lib/tle'
import type { SatelliteEntry, ConstellationKey } from '../lib/tle'
import {
  emitSatelliteHover,
  emitSatelliteSelect,
  useHighlightedNoradIds,
} from './SatelliteInteractionContext'

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

// Brand color per constellation, derived from the shared CONSTELLATIONS
// metadata so each sat dot matches its sidebar legend swatch exactly
// (single source of truth lives in tle.ts). Colors are chosen for high
// contrast against the blue Earth + atmosphere so the fleets stay
// tellable apart where their shells overlap.
const CONSTELLATION_COLOR = Object.fromEntries(
  CONSTELLATIONS.map((c) => [c.key, new THREE.Color(c.color)]),
) as Record<ConstellationKey, THREE.Color>

// How many sats to propagate per frame. With 60fps that's 16ms/frame
// — we want sat propagation to take <4ms. 1/16 of the cloud per frame
// → all sats refreshed every ~250ms at 60fps. Plenty for visual
// smoothness given how slowly sats move in our viewport.
const PROPAGATE_FRACTION = 1 / 16

// Raycaster picking threshold in scene units. Orbit altitudes sit
// around 5.43 (Starlink Shell 1) so 0.12 ≈ 150 km picking radius —
// tight enough not to grab through the Earth, loose enough for
// finger-friendly hovers at the default zoom.
const PICK_THRESHOLD = 0.12

// Throttle pointer-move raycasting to ~30 fps so we don't burn frame
// budget chasing every mouse pixel.
const HOVER_INTERVAL_MS = 33

/** Live hit data forwarded to the host view for tooltip/card UI.
 *  Position is the freshly-propagated ECI vector (km) so we can
 *  derive altitude + velocity without re-running SGP4 in the host. */
export interface SatelliteHit {
  entry: SatelliteEntry
  /** Altitude in km above Earth surface. */
  altitudeKm: number
  /** Orbital speed in km/s. */
  velocityKmS: number
  /** Orbital period in minutes (2π / mean-motion). */
  periodMin: number
  /** Mouse position in CSS pixels relative to the viewport, for
   *  tooltip placement. */
  clientX: number
  clientY: number
}

interface Props {
  satellites: SatelliteEntry[]
  /** When set, only sats in this set render. undefined = render all. */
  enabledConstellations?: Set<ConstellationKey>
}

export default function SatelliteCloud({
  satellites,
  enabledConstellations,
}: Props) {
  // The set of sats to render enlarged + brighter (selected sats +
  // the hovered one), published by the host via the pub/sub context.
  const highlightedNoradIds = useHighlightedNoradIds()

  const visibleSats = useMemo(() => {
    if (!enabledConstellations) return satellites
    return satellites.filter(s => enabledConstellations.has(s.constellation))
  }, [satellites, enabledConstellations])

  const count = visibleSats.length

  // Allocate buffers once per (visibleSats) tuple. Color/size are
  // filled here at creation time with the BASE (non-highlight) values;
  // a separate effect punches the highlight color/size onto whichever
  // single sat is currently highlighted. Decoupling highlight from
  // buffer creation is critical — otherwise every hover-tick would
  // re-allocate 8k×7 floats AND re-propagate every sat (positions
  // depend on the same useMemo via the mount-time effect below).
  const buffers = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const sat = visibleSats[i]
      const c = CONSTELLATION_COLOR[sat.constellation]
      colors[i * 3 + 0] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
      // Base dot size — bumped so individual sats are comfortably
      // visible at default zoom without the cluster bleeding to a
      // solid sheet (the tight fragment falloff keeps them crisp).
      sizes[i] = 2.6
    }
    return { positions, colors, sizes }
  }, [visibleSats, count])
  const { positions, colors, sizes } = buffers

  // Map noradId → index in visibleSats. Cheap O(1) lookup so the
  // highlight effect can rewrite just one sat's color/size entries
  // without scanning the array.
  const noradIndex = useMemo(() => {
    const m = new Map<number, number>()
    for (let i = 0; i < visibleSats.length; i++) m.set(visibleSats[i].noradId, i)
    return m
  }, [visibleSats])

  const geometryRef = useRef<THREE.BufferGeometry>(null)
  const pointsRef = useRef<THREE.Points>(null)
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  // Stable Three vector instances reused per frame.
  const tmpVec = useRef(new THREE.Vector3())
  // Frame counter to slice which sats get propagated this tick.
  const frameNumRef = useRef(0)
  // Track which sat indices are currently rendering as highlighted so
  // we can reset them to base color when they leave the selection.
  const highlightedIndicesRef = useRef<Set<number>>(new Set())

  // Propagate every sat once on mount so the initial frame isn't a
  // pile of (0,0,0) points clustered at Earth's center. Also resets
  // the highlight-tracking ref so the next highlight effect doesn't
  // try to "unhighlight" a stale index in the freshly-allocated
  // buffer (which is already base-colored).
  useEffect(() => {
    if (count === 0) return
    highlightedIndicesRef.current = new Set()
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

  // ============================================
  // Highlight a single sat without re-allocating the cloud buffers.
  // ============================================
  // Resets the previously-highlighted sat back to its constellation
  // base color/size, then writes the highlight palette to the newly
  // selected sat. Touches at most 8 floats per frame — basically
  // free regardless of cloud size.
  //
  // We read the underlying TypedArrays back off the live geometry
  // attribute (not the useMemo refs) because mutating values returned
  // from a hook is forbidden by react-hooks/immutability. Doing it
  // via getAttribute(...).array also guarantees we're writing to the
  // exact buffer the GPU is sampling.
  useEffect(() => {
    if (count === 0) return
    if (!geometryRef.current) return
    const colorAttr = geometryRef.current.getAttribute('color') as THREE.BufferAttribute | undefined
    const sizeAttr = geometryRef.current.getAttribute('size') as THREE.BufferAttribute | undefined
    if (!colorAttr || !sizeAttr) return
    const colorArr = colorAttr.array as Float32Array
    const sizeArr = sizeAttr.array as Float32Array

    // Resolve the highlighted norad-id set → indices in this cloud.
    const prev = highlightedIndicesRef.current
    const next = new Set<number>()
    for (const id of highlightedNoradIds) {
      const idx = noradIndex.get(id)
      if (idx != null && idx < count) next.add(idx)
    }

    // Reset sats that were highlighted but no longer are.
    for (const idx of prev) {
      if (next.has(idx)) continue
      const sat = visibleSats[idx]
      const c = CONSTELLATION_COLOR[sat.constellation]
      colorArr[idx * 3 + 0] = c.r
      colorArr[idx * 3 + 1] = c.g
      colorArr[idx * 3 + 2] = c.b
      sizeArr[idx] = 2.6
    }
    // Paint highlight on the newly highlighted sats — bright warm
    // white + enlarged so they pop out of the cloud.
    for (const idx of next) {
      if (prev.has(idx)) continue
      colorArr[idx * 3 + 0] = 1.0
      colorArr[idx * 3 + 1] = 0.92
      colorArr[idx * 3 + 2] = 0.55
      sizeArr[idx] = 5.2
    }
    highlightedIndicesRef.current = next
    colorAttr.needsUpdate = true
    sizeAttr.needsUpdate = true
  }, [highlightedNoradIds, noradIndex, visibleSats, count])

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

  // ============================================
  // Pointer interaction — hover + click raycasting.
  // ============================================
  // We attach listeners to gl.domElement (the actual <canvas>) rather
  // than relying on r3f's onPointerMove because we want full control
  // over throttling and raycast-threshold per gesture. The hit info
  // is fanned out to the host view via a module-level emitter (see
  // SatelliteInteractionContext.tsx for why).
  const { camera, gl } = useThree()

  // Keep the latest visibleSats accessible from the long-lived DOM
  // listener without re-binding the listener every render.
  const visibleSatsRef = useRef(visibleSats)
  useEffect(() => { visibleSatsRef.current = visibleSats }, [visibleSats])

  useEffect(() => {
    if (count === 0) return

    const canvas = gl.domElement
    const raycaster = new THREE.Raycaster()
    raycaster.params.Points = { threshold: PICK_THRESHOLD }
    const ndc = new THREE.Vector2()
    let lastHoverAt = 0
    // Last index reported as hovered — used to suppress redundant
    // hover events when the cursor lingers over the same sat across
    // many pointer-move events.
    let lastHoveredIndex = -1

    /** Run raycaster against current Points geometry. Returns the
     *  nearest hit's index in visibleSats, or -1. We pick the hit
     *  with the smallest distanceToRay (tightest visual match)
     *  rather than the camera-nearest hit, which feels more like
     *  "what the user is aiming at" when sats overlap. */
    function pickIndex(clientX: number, clientY: number): number {
      if (!pointsRef.current) return -1
      const rect = canvas.getBoundingClientRect()
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObject(pointsRef.current, false)
      if (hits.length === 0) return -1
      let best = hits[0]
      for (const h of hits) {
        if ((h.distanceToRay ?? Infinity) < (best.distanceToRay ?? Infinity)) best = h
      }
      return best.index ?? -1
    }

    /** Compute the live altitude/velocity/period info for a hit, using
     *  a fresh propagate() call. We can't reuse the buffer position
     *  (it lags by up to 250 ms due to round-robin propagation), and
     *  we need velocity anyway — which isn't in the buffer. */
    function buildHit(index: number, clientX: number, clientY: number): SatelliteHit | null {
      const list = visibleSatsRef.current
      const entry = list[index]
      if (!entry) return null
      const now = new Date()
      const pv = propagate(entry.satrec, now)
      let altitudeKm = 0
      let velocityKmS = 0
      if (pv?.position && typeof pv.position !== 'boolean') {
        altitudeKm = Math.hypot(pv.position.x, pv.position.y, pv.position.z) - EARTH_RADIUS_KM
      }
      if (pv?.velocity && typeof pv.velocity !== 'boolean') {
        velocityKmS = Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z)
      }
      // mean motion `no` is in radians/minute → orbital period in
      // minutes = 2π / no.
      const periodMin = entry.satrec.no > 0 ? (2 * Math.PI) / entry.satrec.no : 0
      return { entry, altitudeKm, velocityKmS, periodMin, clientX, clientY }
    }

    function handlePointerMove(ev: PointerEvent) {
      const now = Date.now()
      if (now - lastHoverAt < HOVER_INTERVAL_MS) return
      lastHoverAt = now
      const idx = pickIndex(ev.clientX, ev.clientY)
      if (idx === -1) {
        if (lastHoveredIndex !== -1) {
          lastHoveredIndex = -1
          emitSatelliteHover(null)
          canvas.style.cursor = ''
        }
        return
      }
      // Same sat as last tick — refresh client coords so the tooltip
      // follows the cursor.
      const hit = buildHit(idx, ev.clientX, ev.clientY)
      if (!hit) return
      if (idx !== lastHoveredIndex) {
        lastHoveredIndex = idx
        canvas.style.cursor = 'pointer'
      }
      emitSatelliteHover(hit)
    }

    function handlePointerLeave() {
      if (lastHoveredIndex !== -1) {
        lastHoveredIndex = -1
        emitSatelliteHover(null)
        canvas.style.cursor = ''
      }
    }

    function handleClick(ev: MouseEvent) {
      const idx = pickIndex(ev.clientX, ev.clientY)
      if (idx === -1) {
        // Clicked empty space → dismiss the pinned card.
        emitSatelliteSelect(null)
        return
      }
      const hit = buildHit(idx, ev.clientX, ev.clientY)
      emitSatelliteSelect(hit)
    }

    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerleave', handlePointerLeave)
    canvas.addEventListener('click', handleClick)
    return () => {
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerleave', handlePointerLeave)
      canvas.removeEventListener('click', handleClick)
      // Reset cursor on teardown in case we navigated away mid-hover.
      canvas.style.cursor = ''
    }
  }, [camera, gl, count])

  if (count === 0) return null

  return (
    <points ref={pointsRef}>
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
  // stay visible (min raised so the far limb of the constellation
  // doesn't shrink to invisibility) and close ones don't take over.
  float scale = clamp(70.0 / -mvPos.z, 1.6, 14.0);
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
