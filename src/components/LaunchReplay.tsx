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
// play / scrub / change speed without per-frame React re-renders), pops an
// event nameplate at each real event, and writes the sun-time so lighting
// matches the launch's actual time of day.

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

interface Props {
  launch: PastLaunch
  ctrlRef: React.MutableRefObject<ReplayControl>
  sunTimeRef: React.MutableRefObject<number | null>
}

export default function LaunchReplay({ launch, ctrlRef, sunTimeRef }: Props) {
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

  const groupRef = useRef<THREE.Group>(null)
  const labelRef = useRef<HTMLDivElement>(null)
  const tmp = useRef(new THREE.Vector3())

  // Reset the clock when the launch changes.
  useEffect(() => {
    const c = ctrlRef.current
    c.t = 0
    c.duration = profile.totalDur
    c.currentEvent = null
    c.seekTo = null
  }, [profile, ctrlRef])

  // Restore live lighting on unmount.
  useEffect(() => {
    return () => {
      sunTimeRef.current = null
    }
  }, [sunTimeRef])

  useFrame((_, deltaRaw) => {
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

    sunTimeRef.current = netMs + c.t * 1000

    let label: string | null = null
    for (const e of launch.events) {
      if (e.t <= c.t) label = e.label
      else break
    }
    if (label !== c.currentEvent) {
      c.currentEvent = label
      if (labelRef.current) labelRef.current.textContent = label ?? ''
    }
  })

  return (
    <>
      <Line points={points} color="#ff9a4a" lineWidth={2} transparent opacity={0.55} />
      <group ref={groupRef}>
        <mesh>
          <sphereGeometry args={[0.045, 14, 14]} />
          <meshBasicMaterial color="#fff4d6" toneMapped={false} />
        </mesh>
        <Html
          center
          zIndexRange={[15, 0]}
          style={{ pointerEvents: 'none' }}
          wrapperClass="replay-wrapper"
        >
          <div className="replay-nameplate" ref={labelRef} />
        </Html>
      </group>
    </>
  )
}
