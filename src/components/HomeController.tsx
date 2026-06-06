import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

// Eases the camera back to the default home framing when `signal` bumps.
// Auto-rotate is forced off during the ease (so it doesn't fight) and
// restored to the desired value when the ease completes.

const HOME = new THREE.Vector3(0, 2, 21) // matches the Canvas initial camera
const ORIGIN = new THREE.Vector3(0, 0, 0)

interface Props {
  controlsRef: React.RefObject<OrbitControlsImpl | null>
  /** Bump to trigger a reset-to-home. */
  signal: number
  /** Auto-rotate value to restore once home is reached. */
  autoRotate: boolean
}

export default function HomeController({ controlsRef, signal, autoRotate }: Props) {
  const camera = useThree((s) => s.camera)
  const easing = useRef(false)
  const prevSignal = useRef(0)

  useFrame((_, deltaRaw) => {
    const controls = controlsRef.current
    if (!controls) return
    if (signal !== prevSignal.current) {
      prevSignal.current = signal
      if (signal > 0) easing.current = true
    }
    if (!easing.current) return

    controls.autoRotate = false // hold the spin off for the whole ease
    const dt = Math.min(deltaRaw, 0.05)
    const k = 1 - Math.exp(-3 * dt)
    camera.position.lerp(HOME, k)
    controls.target.lerp(ORIGIN, k)
    controls.update()

    if (camera.position.distanceTo(HOME) < 0.04 && controls.target.lengthSq() < 1e-4) {
      camera.position.copy(HOME)
      controls.target.set(0, 0, 0)
      controls.autoRotate = autoRotate
      controls.update()
      easing.current = false
    }
  })

  return null
}
