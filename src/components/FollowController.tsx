import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

// ============================================
// FOLLOW CONTROLLER — fly to + softly follow a moving target (the ISS)
// ============================================
// Phases:
//   ORIENT   — sweep the camera AROUND the globe (never across it) until it's
//              on the same side as the target.
//   APPROACH — ease the target onto the ISS and pull the camera in to a nice
//              framing distance.
//   FOLLOW   — keep the ISS centred as it sweeps through orbit, but DON'T lock
//              the distance: the user can freely zoom in/out and still follow.
//   DETACHED — the moment the user rotates/orbits the view, stop steering so
//              they can look around freely (onDetached fires so the UI can
//              offer a "Recenter on ISS" prompt). A recenterSignal bump
//              re-flies from wherever they are.
// On deactivate it just resets; the caller eases the camera home.

const FOLLOW_DIST = 2.0 // framing distance when we first arrive
const FOLLOW_MIN_DISTANCE = 0.35 // let the camera get this close to the target
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
  /** Bump to re-fly to the ISS from wherever the camera is. */
  recenterSignal?: number
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
      if (!target) return // wait for a live ISS position
      const dist = camera.position.length()
      curDir.current.copy(camera.position).normalize()
      issDir.current.copy(target).normalize()
      curDir.current.lerp(issDir.current, 1 - Math.exp(-3.5 * dt)).normalize()
      camera.position.copy(curDir.current).multiplyScalar(dist)
      controls.target.set(0, 0, 0)
      controls.update()
      if (curDir.current.angleTo(issDir.current) < ORIENT_ALIGN) {
        phase.current = 'approach'
        prevTarget.current.copy(target)
      }
    } else if (phase.current === 'approach') {
      const target = targetRef.current
      if (!target) return
      // Rigid-follow the ISS movement, ease the target onto it, pull the
      // camera in to the framing distance.
      tmp.current.copy(target).sub(prevTarget.current)
      camera.position.add(tmp.current)
      controls.target.add(tmp.current)
      prevTarget.current.copy(target)
      controls.target.lerp(target, 0.15)
      const dir = tmp.current.copy(camera.position).sub(controls.target)
      const dist = dir.length()
      if (dist > 1e-4) {
        const want = THREE.MathUtils.damp(dist, FOLLOW_DIST, 2.5, dt)
        camera.position.copy(controls.target).addScaledVector(dir, want / dist)
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
      // Rigid-follow: translate the whole rig by the ISS's motion so it stays
      // centred while the user's zoom + viewing angle are preserved (we never
      // force the distance, so zooming in/out keeps following). Moving camera
      // AND target by the same delta leaves the orbit angle untouched...
      tmp.current.copy(target).sub(prevTarget.current)
      camera.position.add(tmp.current)
      controls.target.add(tmp.current)
      prevTarget.current.copy(target)
      controls.update()
      // ...so any change in the orbit angle now means the user rotated the
      // view → hand off and let them look around freely.
      const az = controls.getAzimuthalAngle()
      const pol = controls.getPolarAngle()
      if (Math.abs(az - lastAz.current) > ROTATE_EPS || Math.abs(pol - lastPol.current) > ROTATE_EPS) {
        phase.current = 'detached'
        onDetached?.()
      }
      lastAz.current = az
      lastPol.current = pol
    }
    // 'detached' — hands off entirely; user has full control, line stays on.
  })

  return null
}
