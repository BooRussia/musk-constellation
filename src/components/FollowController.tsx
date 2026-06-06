import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

// ============================================
// FOLLOW CONTROLLER — chase-cam for a moving target (the ISS)
// ============================================
// Engage in two phases so the camera NEVER flies through the planet:
//   1) ORIENT — sweep the camera around the globe at its current distance
//      until it's on the same side as the target (target stays the Earth
//      centre, so the ISS swings into view), then
//   2) FOLLOW — pull in to a close distance and track the target rigidly as
//      it sweeps through orbit (the user can still orbit around it).
// On release it eases the target back to Earth centre and restores limits.

const FOLLOW_DIST = 1.5 // scene units from the target while following
const FOLLOW_MIN_DISTANCE = 0.35 // let the camera get this close to the target
const ORIENT_ALIGN = 0.12 // rad (~7°) — switch to FOLLOW once this aligned

interface Props {
  controlsRef: React.RefObject<OrbitControlsImpl | null>
  active: boolean
  targetRef: React.MutableRefObject<THREE.Vector3 | null>
}

export default function FollowController({ controlsRef, active, targetRef }: Props) {
  const camera = useThree((s) => s.camera)
  const phase = useRef<'idle' | 'orient' | 'follow' | 'release'>('idle')
  const prevTarget = useRef(new THREE.Vector3())
  const savedMinDistance = useRef<number | null>(null)
  const curDir = useRef(new THREE.Vector3())
  const issDir = useRef(new THREE.Vector3())
  const tmp = useRef(new THREE.Vector3())
  const releaseT = useRef(0)

  useFrame((_, deltaRaw) => {
    const controls = controlsRef.current
    if (!controls) return
    const dt = Math.min(deltaRaw, 0.05)

    // --- transitions ---
    if (active && phase.current === 'idle') {
      phase.current = 'orient'
      savedMinDistance.current = controls.minDistance
      controls.minDistance = FOLLOW_MIN_DISTANCE
    } else if (!active && (phase.current === 'orient' || phase.current === 'follow')) {
      phase.current = 'release'
      releaseT.current = 0
    }

    if (phase.current === 'orient') {
      const target = targetRef.current
      if (!target) return // wait for a live ISS position
      // Sweep the camera direction toward the ISS direction at constant
      // distance — an arc AROUND the globe, never across it. Target stays
      // at the centre so the station rotates into frame.
      const dist = camera.position.length()
      curDir.current.copy(camera.position).normalize()
      issDir.current.copy(target).normalize()
      curDir.current.lerp(issDir.current, 1 - Math.exp(-3.5 * dt)).normalize()
      camera.position.copy(curDir.current).multiplyScalar(dist)
      controls.target.set(0, 0, 0)
      controls.update()
      if (curDir.current.angleTo(issDir.current) < ORIENT_ALIGN) {
        phase.current = 'follow'
        prevTarget.current.copy(target)
      }
    } else if (phase.current === 'follow') {
      const target = targetRef.current
      if (!target) return
      // 1) Rigid follow — shift camera + target by however far the target
      //    moved this frame, preserving the user's relative view.
      tmp.current.copy(target).sub(prevTarget.current)
      camera.position.add(tmp.current)
      controls.target.add(tmp.current)
      prevTarget.current.copy(target)
      // 2) Ease the target onto the ISS and pull the camera in to FOLLOW_DIST.
      controls.target.lerp(target, 0.1)
      const dir = tmp.current.copy(camera.position).sub(controls.target)
      const dist = dir.length()
      if (dist > 1e-4) {
        const want = THREE.MathUtils.damp(dist, FOLLOW_DIST, 2.5, dt)
        camera.position.copy(controls.target).addScaledVector(dir, want / dist)
      }
      controls.update()
    } else if (phase.current === 'release') {
      releaseT.current += dt
      controls.target.lerp(ORIGIN, 0.08)
      controls.update()
      if (releaseT.current > 0.9 || controls.target.lengthSq() < 1e-4) {
        controls.target.set(0, 0, 0)
        if (savedMinDistance.current != null) controls.minDistance = savedMinDistance.current
        savedMinDistance.current = null
        phase.current = 'idle'
        controls.update()
      }
    }
  })

  return null
}

const ORIGIN = new THREE.Vector3(0, 0, 0)
