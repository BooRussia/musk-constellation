import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import type { PastLaunch } from '../lib/pastLaunches'
import { buildProfile } from '../lib/trajectory'

// ============================================
// LAUNCH REPLAY — animate a past launch's flight path on the globe
// ============================================
// Draws the modeled ascent-to-orbit track, flies a vehicle marker along it
// on the real mission clock (driven by the shared control ref so the UI can
// play / scrub / change speed without per-frame React re-renders), and marks
// every real event (MECO, stage sep, SECO, deploy…) with a dot on the path
// that lights up as the vehicle passes it — the way SpaceX timelines their
// webcasts. Also writes the sun-time so lighting matches the launch's actual
// time of day.

const EARTH_RADIUS_SCENE = 5
const KM_TO_SCENE = EARTH_RADIUS_SCENE / 6371
const RAD = Math.PI / 180

export interface ReplayControl {
  /** Current mission time, seconds from liftoff (replay writes, UI reads). */
  t: number
  /** Total replay length, seconds (replay writes). */
  duration: number
  /** UI sets; replay obeys. */
  playing: boolean
  speed: number
  /** UI sets to jump to a time; replay consumes and clears. */
  seekTo: number | null
  /** Last event passed (replay writes, UI reads). */
  currentEvent: string | null
}

function toScene(lat: number, lon: number, altKm: number, out: THREE.Vector3): THREE.Vector3 {
  const r = EARTH_RADIUS_SCENE + altKm * KM_TO_SCENE
  const phi = lat * RAD
  const lam = lon * RAD
  const cp = Math.cos(phi)
  return out.set(cp * Math.cos(lam), Math.sin(phi), -cp * Math.sin(lam)).multiplyScalar(r)
}

/** True when the Earth sphere blocks the straight line from camera to point. */
function occludedByEarth(cam: THREE.Vector3, point: THREE.Vector3, dir: THREE.Vector3): boolean {
  dir.subVectors(cam, point)
  const dist = dir.length()
  if (dist < 1e-4) return false
  dir.divideScalar(dist)
  const b = 2 * point.dot(dir)
  const c = point.lengthSq() - EARTH_RADIUS_SCENE * EARTH_RADIUS_SCENE
  const disc = b * b - 4 * c
  if (disc <= 0) return false
  const sq = Math.sqrt(disc)
  const t1 = (-b - sq) / 2
  const t2 = (-b + sq) / 2
  const tHit = t1 > 1e-3 ? t1 : t2 > 1e-3 ? t2 : -1
  return tHit > 1e-3 && tHit < dist - 1e-3
}

/** Compact a verbose event label (prefer a parenthetical acronym). */
function shortLabel(s: string): string {
  const m = s.match(/\(([^)]+)\)/)
  if (m) return m[1]
  return s.length > 20 ? `${s.slice(0, 19)}…` : s
}

interface Props {
  launch: PastLaunch
  ctrlRef: React.MutableRefObject<ReplayControl>
  sunTimeRef: React.MutableRefObject<number | null>
  /** Receives the vehicle's live world position (for the chase-cam). */
  posRef?: React.MutableRefObject<THREE.Vector3 | null>
}

export default function LaunchReplay({ launch, ctrlRef, sunTimeRef, posRef }: Props) {
  const profile = useMemo(() => buildProfile(launch), [launch])
  const netMs = useMemo(() => new Date(launch.net).getTime(), [launch])

  // Full predicted track as scene points (for the path line).
  const points = useMemo(() => {
    const N = 256
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= N; i++) {
      const p = profile.sample((i / N) * profile.totalDur)
      pts.push(toScene(p.lat, p.lon, p.altKm, new THREE.Vector3()))
    }
    return pts
  }, [profile])

  // Each real event, positioned on the path.
  const markers = useMemo(() => {
    return launch.events
      .filter((e) => e.t >= 0 && e.t <= profile.totalDur)
      .map((e) => {
        const p = profile.sample(e.t)
        return {
          label: shortLabel(e.label),
          full: e.label,
          t: e.t,
          pos: toScene(p.lat, p.lon, p.altKm, new THREE.Vector3()),
        }
      })
  }, [launch, profile])

  const groupRef = useRef<THREE.Group>(null)
  const tmp = useRef(new THREE.Vector3())
  const tmpDir = useRef(new THREE.Vector3())
  const markerRefs = useRef<(HTMLDivElement | null)[]>([])
  const clsCache = useRef<string[]>([])
  const dispCache = useRef<string[]>([])

  // Reset the clock when the launch changes.
  useEffect(() => {
    const c = ctrlRef.current
    c.t = 0
    c.duration = profile.totalDur
    c.currentEvent = null
    c.seekTo = null
    clsCache.current = []
    dispCache.current = []
  }, [profile, ctrlRef])

  // Restore live lighting on unmount.
  useEffect(() => {
    return () => {
      sunTimeRef.current = null
    }
  }, [sunTimeRef])

  useFrame((state, deltaRaw) => {
    const c = ctrlRef.current
    const dt = Math.min(deltaRaw, 0.05)
    if (c.seekTo != null) {
      c.t = THREE.MathUtils.clamp(c.seekTo, 0, profile.totalDur)
      c.seekTo = null
    } else if (c.playing) {
      c.t = Math.min(profile.totalDur, c.t + dt * c.speed)
    }

    const p = profile.sample(c.t)
    toScene(p.lat, p.lon, p.altKm, tmp.current)
    if (groupRef.current) groupRef.current.position.copy(tmp.current)
    if (posRef) {
      if (!posRef.current) posRef.current = tmp.current.clone()
      else posRef.current.copy(tmp.current)
    }

    sunTimeRef.current = netMs + c.t * 1000

    // Which events have happened; the last one is "active".
    let active = -1
    for (let i = 0; i < markers.length; i++) {
      if (markers[i].t <= c.t) active = i
      else break
    }
    c.currentEvent = active >= 0 ? markers[active].full : null

    // Light up / occlude each event marker.
    const cam = state.camera.position
    for (let i = 0; i < markers.length; i++) {
      const el = markerRefs.current[i]
      if (!el) continue
      const disp = occludedByEarth(cam, markers[i].pos, tmpDir.current) ? 'none' : ''
      if (dispCache.current[i] !== disp) {
        el.style.display = disp
        dispCache.current[i] = disp
      }
      const cls = `replay-evt${i <= active ? ' is-passed' : ''}${i === active ? ' is-active' : ''}`
      if (clsCache.current[i] !== cls) {
        el.className = cls
        clsCache.current[i] = cls
      }
    }
  })

  return (
    <>
      <Line
        points={points}
        color="#ff9a4a"
        lineWidth={2}
        transparent
        opacity={0.5}
        depthWrite={false}
        renderOrder={5}
      />

      {/* Event markers — a dot on the path per real event, lit as it passes. */}
      {markers.map((m, i) => (
        <group key={`${m.t}-${i}`} position={m.pos}>
          <Html
            center
            zIndexRange={[14, 0]}
            style={{ pointerEvents: 'none' }}
            wrapperClass="replay-evt-wrapper"
          >
            <div className="replay-evt" ref={(el) => { markerRefs.current[i] = el }}>
              <span className="replay-evt-dot" />
              <span className="replay-evt-label">{m.label}</span>
            </div>
          </Html>
        </group>
      ))}

      {/* The vehicle. */}
      <group ref={groupRef}>
        <mesh>
          <sphereGeometry args={[0.05, 16, 16]} />
          <meshBasicMaterial color="#fff4d6" toneMapped={false} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshBasicMaterial color="#ff9a4a" transparent opacity={0.25} toneMapped={false} />
        </mesh>
      </group>
    </>
  )
}
