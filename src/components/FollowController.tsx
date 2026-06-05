import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

// ============================================
// FOLLOW CONTROLLER — chase-cam for a moving target (the ISS)
// ============================================
// When `active`, locks the OrbitControls target onto the live target
// position and flies the camera in to a close distance, then tracks the
// target rigidly so it stays centred as it sweeps through orbit (the user
// can still orbit around it). On release it eases the target back to the
// Earth's centre and restores the normal zoom limits.

const FOLLOW_DIST = 1.5 // scene units from the target while following
const FOLLOW_MIN_DISTANCE = 0.35 // let the camera get this close to the target

interface Props {
  controlsRef: React.RefObject<OrbitControlsImpl | null>
  active: boolean
  targetRef: React.MutableRefObject<THREE.Vector3 | null>
}

export default function FollowController({ controlsRef, active, targetRef }: Props) {
  const camera = useThree((s) => s.camera)
  const phase = useRef<'idle' | 'follow' | 'release'>('idle')
  const prevTarget = useRef(new THREE.Vector3())
  const savedMinDistance = useRef<number | null>(null)
  const tmp = useRef(new THREE.Vector3())
  const releaseT = useRef(0)

  useFrame((_, deltaRaw) => {
    const controls = controlsRef.current
    if (!controls) return
    const dt = Math.min(deltaRaw, 0.05)

    // --- transition into / out of follow mode ---
    if (active && phase.current === 'idle') {
      phase.current = 'follow'
      savedMinDistance.current = controls.minDistance
      controls.minDistance = FOLLOW_MIN_DISTANCE
      const t = targetRef.current
      prevTarget.current.copy(t ?? controls.target)
    } else if (!active && phase.current === 'follow') {
      phase.current = 'release'
      releaseT.current = 0
    }

    if (phase.current === 'follow') {
      const target = targetRef.current
      if (!target) return
      // 1) Rigid follow — shift camera + target by however far the target
      //    moved this frame, preserving the user's relative view.
      tmp.current.copy(target).sub(prevTarget.current)
      camera.position.add(tmp.current)
      controls.target.add(tmp.current)
      prevTarget.current.copy(target)
      // 2) Ease the target onto the ISS and pull the camera in to
      //    FOLLOW_DIST (smooth zoom-in on engage; steady-state no-op).
      controls.target.lerp(target, 0.1)
      const dir = tmp.current.copy(camera.position).sub(controls.target)
      const dist = dir.length()
      if (dist > 1e-4) {
        const want = THREE.MathUtils.damp(dist, FOLLOW_DIST, 2.5, dt)
        camera.position.copy(controls.target).addScaledVector(dir, want / dist)
      }
      controls.update()
    } else if (phase.current === 'release') {
      // Ease the target back to Earth centre, then hand control back.
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
