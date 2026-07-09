import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import type { PastLaunch } from '../lib/pastLaunches'
import { buildProfile } from '../lib/trajectory'
import {
  eventsForReplay,
  stageMetaForLabel,
  type StageAction,
} from '../lib/launchSequence'
import RocketVehicle, { type RocketVehicleHandle } from './RocketVehicle'
import type { CSSProperties } from 'react'

// ============================================
// LAUNCH REPLAY — animate a past launch's flight path on the globe
// ============================================
// Draws the modeled ascent-to-orbit track, flies a small rocket marker along
// it on the mission clock (driven by the shared control ref so the UI can
// play / scrub / change speed without per-frame React re-renders), and marks
// every real event (MECO, stage sep, SECO, deploy…) with a colored stage-action
// dot that lights up as the vehicle passes — SpaceX webcast style. Also writes
// the sun-time so lighting matches the launch's actual time of day.

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
  /** Stage action for the current event (replay writes, UI reads). */
  currentAction: StageAction | null
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
  /** When set, the clock is driven by real time since this liftoff (ms epoch)
   *  instead of the play/scrub controls — a LIVE launch simulation. */
  liveNetMs?: number
}

export default function LaunchReplay({ launch, ctrlRef, sunTimeRef, posRef, liveNetMs }: Props) {
  const profile = useMemo(() => buildProfile(launch), [launch])
  const netMs = useMemo(() => new Date(launch.net).getTime(), [launch])

  const flightEvents = useMemo(() => eventsForReplay(launch.events), [launch.events])

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

  // Each event, positioned on the path with its stage-action accent.
  const markers = useMemo(() => {
    return flightEvents
      .filter((e) => e.t >= 0 && e.t <= profile.totalDur)
      .map((e) => {
        const p = profile.sample(e.t)
        const meta = stageMetaForLabel(e.label)
        return {
          label: shortLabel(e.label),
          full: e.label,
          t: e.t,
          action: meta.action,
          color: meta.color,
          intensity: meta.intensity,
          verb: meta.verb,
          pos: toScene(p.lat, p.lon, p.altKm, new THREE.Vector3()),
        }
      })
  }, [flightEvents, profile])

  const groupRef = useRef<THREE.Group>(null)
  const rocketRef = useRef<RocketVehicleHandle>(null)
  const tmp = useRef(new THREE.Vector3())
  const tmpAhead = useRef(new THREE.Vector3())
  const tmpDir = useRef(new THREE.Vector3())
  const upAxis = useRef(new THREE.Vector3(0, 1, 0))
  const quat = useRef(new THREE.Quaternion())
  const markerRefs = useRef<(HTMLDivElement | null)[]>([])
  const clsCache = useRef<string[]>([])
  const dispCache = useRef<string[]>([])
  const lastActionRef = useRef<StageAction | null>(null)

  // Reset the clock when the launch changes.
  useEffect(() => {
    const c = ctrlRef.current
    c.t = 0
    c.duration = profile.totalDur
    c.currentEvent = null
    c.currentAction = null
    c.seekTo = null
    clsCache.current = []
    dispCache.current = []
    lastActionRef.current = null
    rocketRef.current?.resetAccent()
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
    if (liveNetMs != null) {
      // LIVE: clock = real time since liftoff (no play/scrub).
      c.t = THREE.MathUtils.clamp((Date.now() - liveNetMs) / 1000, 0, profile.totalDur)
    } else if (c.seekTo != null) {
      c.t = THREE.MathUtils.clamp(c.seekTo, 0, profile.totalDur)
      c.seekTo = null
    } else if (c.playing) {
      c.t = Math.min(profile.totalDur, c.t + dt * c.speed)
    }

    const p = profile.sample(c.t)
    toScene(p.lat, p.lon, p.altKm, tmp.current)
    if (groupRef.current) {
      groupRef.current.position.copy(tmp.current)

      // Point the rocket nose along the flight path (sample a short look-ahead).
      const ahead = profile.sample(Math.min(profile.totalDur, c.t + 2))
      toScene(ahead.lat, ahead.lon, ahead.altKm, tmpAhead.current)
      tmpDir.current.subVectors(tmpAhead.current, tmp.current)
      if (tmpDir.current.lengthSq() > 1e-10) {
        tmpDir.current.normalize()
        quat.current.setFromUnitVectors(upAxis.current, tmpDir.current)
        groupRef.current.quaternion.copy(quat.current)
      }
    }
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
    const activeMarker = active >= 0 ? markers[active] : null
    c.currentEvent = activeMarker?.full ?? null
    c.currentAction = activeMarker?.action ?? null

    // Vehicle glow / plume follows the active stage action.
    if (activeMarker && lastActionRef.current !== activeMarker.action) {
      lastActionRef.current = activeMarker.action
      rocketRef.current?.setAccent(activeMarker.color, activeMarker.intensity)
    } else if (!activeMarker && lastActionRef.current != null) {
      lastActionRef.current = null
      rocketRef.current?.resetAccent()
    }

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
      const cls =
        `replay-evt replay-evt--${markers[i].action}` +
        `${i <= active ? ' is-passed' : ''}${i === active ? ' is-active' : ''}`
      if (clsCache.current[i] !== cls) {
        el.className = cls
        el.style.setProperty('--evt-accent', markers[i].color)
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

      {/* Event markers — colored by stage action, lit as the vehicle passes. */}
      {markers.map((m, i) => (
        <group key={`${m.t}-${i}`} position={m.pos}>
          <Html
            center
            zIndexRange={[14, 0]}
            style={{ pointerEvents: 'none' }}
            wrapperClass="replay-evt-wrapper"
          >
            <div
              className={`replay-evt replay-evt--${m.action}`}
              style={{ '--evt-accent': m.color } as CSSProperties}
              ref={(el) => {
                markerRefs.current[i] = el
              }}
            >
              <span className="replay-evt-dot" />
              <span className="replay-evt-label">
                <span className="replay-evt-verb">{m.verb}</span>
                {m.label}
              </span>
            </div>
          </Html>
        </group>
      ))}

      {/* Compact rocket marker — nose points along the flight path. */}
      <group ref={groupRef}>
        <RocketVehicle ref={rocketRef} />
      </group>
    </>
  )
}
