import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

// ============================================
// FOLLOW CONTROLLER — fly to + softly follow a moving target
// ============================================
// Phases:
//   ORIENT   — sweep the camera AROUND the globe (never across it) until it's
//              on the same side as the target.
//   APPROACH — ease the look-at onto the target and pull the camera in to a
//              nice framing distance.
//   FOLLOW   — keep the target centred as it sweeps through orbit by rotating
//              the camera around Earth's center (so we never clip through the
//              planet). Distance + viewing angle relative to the vehicle are
//              preserved; the user can still zoom.
//   DETACHED — the moment the user rotates/orbits the view, stop steering so
//              they can look around freely (onDetached fires so the UI can
//              offer a "Recenter" prompt). A recenterSignal bump re-flies.
// On deactivate it just resets; the caller eases the camera home.

const FOLLOW_DIST = 2.0 // framing distance when we first arrive
const FOLLOW_MIN_DISTANCE = 0.35 // let the camera get this close to the target
const EARTH_RADIUS = 5
/** Keep the camera outside the Earth sphere + a small air gap. */
const CAM_CLEARANCE = EARTH_RADIUS + 0.35
const ORIENT_ALIGN = 0.12 // rad (~7°) — switch to APPROACH once this aligned
const ARRIVE_DIST = FOLLOW_DIST * 1.12 // close enough → FOLLOW
// A deliberate orbit moves the camera angle far more than this per frame;
// idle (no input) is exactly 0, so this only trips on real user rotation.
const ROTATE_EPS = 0.0016 // rad

type Phase = 'idle' | 'orient' | 'approach' | 'follow' | 'detached'

interface Props {
  controlsRef: React.RefObject<OrbitControlsImpl | null>
  active: boolean
  targetRef: React.MutableRefObject<THREE.Vector3 | null>
  /** Fires once when the user rotates away during FOLLOW. */
  onDetached?: () => void
  /** Bump to re-fly to the target from wherever the camera is. */
  recenterSignal?: number
}

/** Push the camera outside Earth's clearance sphere if it drifted in. */
function clearEarth(cam: THREE.Vector3, scratch: THREE.Vector3): void {
  const r = cam.length()
  if (r < CAM_CLEARANCE && r > 1e-6) {
    cam.copy(scratch.copy(cam).multiplyScalar(CAM_CLEARANCE / r))
  }
}

export default function FollowController({
  controlsRef,
  active,
  targetRef,
  onDetached,
  recenterSignal = 0,
}: Props) {
  const camera = useThree((s) => s.camera)
  const phase = useRef<Phase>('idle')
  const prevTarget = useRef(new THREE.Vector3())
  const savedMinDistance = useRef<number | null>(null)
  const curDir = useRef(new THREE.Vector3())
  const issDir = useRef(new THREE.Vector3())
  const tmp = useRef(new THREE.Vector3())
  const offset = useRef(new THREE.Vector3())
  const prevDir = useRef(new THREE.Vector3())
  const nextDir = useRef(new THREE.Vector3())
  const quat = useRef(new THREE.Quaternion())
  const lastAz = useRef(0)
  const lastPol = useRef(0)
  const lastRecenter = useRef(0)

  useFrame((_, deltaRaw) => {
    const controls = controlsRef.current
    if (!controls) return
    const dt = Math.min(deltaRaw, 0.05)

    // --- transitions ---
    if (active && phase.current === 'idle') {
      phase.current = 'orient'
      savedMinDistance.current = controls.minDistance
      controls.minDistance = FOLLOW_MIN_DISTANCE
      lastRecenter.current = recenterSignal
    } else if (!active && phase.current !== 'idle') {
      // Caller handles the camera (eases home); just reset our state.
      if (savedMinDistance.current != null) controls.minDistance = savedMinDistance.current
      savedMinDistance.current = null
      phase.current = 'idle'
      return
    }

    // Re-fly when the user asks to recenter.
    if (active && recenterSignal !== lastRecenter.current) {
      lastRecenter.current = recenterSignal
      phase.current = 'orient'
    }

    if (phase.current === 'orient') {
      const target = targetRef.current
      if (!target) return // wait for a live position
      const dist = camera.position.length()
      curDir.current.copy(camera.position).normalize()
      issDir.current.copy(target).normalize()
      curDir.current.lerp(issDir.current, 1 - Math.exp(-3.5 * dt)).normalize()
      camera.position.copy(curDir.current).multiplyScalar(Math.max(dist, CAM_CLEARANCE))
      controls.target.set(0, 0, 0)
      controls.update()
      if (curDir.current.angleTo(issDir.current) < ORIENT_ALIGN) {
        phase.current = 'approach'
        prevTarget.current.copy(target)
      }
    } else if (phase.current === 'approach') {
      const target = targetRef.current
      if (!target) return

      // Orbit the camera with the target around Earth (same as FOLLOW), then
      // ease look-at + framing distance in.
      const prevLen = prevTarget.current.length()
      const curLen = target.length()
      if (prevLen > 1e-4 && curLen > 1e-4) {
        prevDir.current.copy(prevTarget.current).multiplyScalar(1 / prevLen)
        nextDir.current.copy(target).multiplyScalar(1 / curLen)
        if (prevDir.current.angleTo(nextDir.current) > 1e-6) {
          quat.current.setFromUnitVectors(prevDir.current, nextDir.current)
          offset.current.copy(camera.position).sub(prevTarget.current)
          offset.current.applyQuaternion(quat.current)
          camera.position.copy(target).add(offset.current)
        } else {
          tmp.current.copy(target).sub(prevTarget.current)
          camera.position.add(tmp.current)
        }
      } else {
        tmp.current.copy(target).sub(prevTarget.current)
        camera.position.add(tmp.current)
      }
      clearEarth(camera.position, tmp.current)
      prevTarget.current.copy(target)

      controls.target.lerp(target, 0.15)
      const dir = tmp.current.copy(camera.position).sub(controls.target)
      const dist = dir.length()
      if (dist > 1e-4) {
        const want = THREE.MathUtils.damp(dist, FOLLOW_DIST, 2.5, dt)
        camera.position.copy(controls.target).addScaledVector(dir, want / dist)
        clearEarth(camera.position, tmp.current)
      }
      controls.update()
      if (dist < ARRIVE_DIST) {
        phase.current = 'follow'
        lastAz.current = controls.getAzimuthalAngle()
        lastPol.current = controls.getPolarAngle()
      }
    } else if (phase.current === 'follow') {
      const target = targetRef.current
      if (!target) return

      // Detect user orbit BEFORE we move the camera — orbital follow itself
      // changes world az/pol, so checking after would false-trigger detach.
      const az = controls.getAzimuthalAngle()
      const pol = controls.getPolarAngle()
      if (Math.abs(az - lastAz.current) > ROTATE_EPS || Math.abs(pol - lastPol.current) > ROTATE_EPS) {
        phase.current = 'detached'
        onDetached?.()
        lastAz.current = az
        lastPol.current = pol
        prevTarget.current.copy(target)
        return
      }

      // Rotate the camera-to-vehicle offset around Earth's center so we ride
      // with the orbit instead of translating through the planet.
      const prevLen = prevTarget.current.length()
      const curLen = target.length()
      if (prevLen > 1e-4 && curLen > 1e-4) {
        prevDir.current.copy(prevTarget.current).multiplyScalar(1 / prevLen)
        nextDir.current.copy(target).multiplyScalar(1 / curLen)
        const ang = prevDir.current.angleTo(nextDir.current)
        if (ang > 1e-6) {
          quat.current.setFromUnitVectors(prevDir.current, nextDir.current)
          offset.current.copy(camera.position).sub(prevTarget.current)
          offset.current.applyQuaternion(quat.current)
          camera.position.copy(target).add(offset.current)
        } else {
          // Near-zero motion — plain translate is fine and avoids quat noise.
          tmp.current.copy(target).sub(prevTarget.current)
          camera.position.add(tmp.current)
        }
      } else {
        tmp.current.copy(target).sub(prevTarget.current)
        camera.position.add(tmp.current)
      }

      clearEarth(camera.position, tmp.current)
      controls.target.copy(target)
      prevTarget.current.copy(target)
      controls.update()

      // Absorb the az/pol change our orbital move just caused so the next
      // frame only trips on real user input.
      lastAz.current = controls.getAzimuthalAngle()
      lastPol.current = controls.getPolarAngle()
    }
    // 'detached' — hands off entirely; user has full control.
  })

  return null
}
