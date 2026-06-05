import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

// ============================================
// LAUNCH FOCUS — spin the globe so a launch pad faces the camera, then stop
// ============================================
// One-shot: when armed, eases the camera around the (origin-centred) globe
// until the pad's surface point is centred in view, keeping the current
// zoom distance, then releases so the user can orbit freely. Auto-rotate is
// gated off by the parent while this is active.

const DEG2RAD = Math.PI / 180

interface Props {
  controlsRef: React.RefObject<OrbitControlsImpl | null>
  active: boolean
  lat: number
  lon: number
  /** Bump to re-arm the ease (e.g. re-clicking the pill to recentre). */
  signal: number
}

export default function LaunchFocusController({ controlsRef, active, lat, lon, signal }: Props) {
  const camera = useThree((s) => s.camera)
  const targetDir = useRef(new THREE.Vector3())
  const curDir = useRef(new THREE.Vector3())
  const settling = useRef(false)

  useEffect(() => {
    if (!active) {
      settling.current = false
      return
    }
    const phi = lat * DEG2RAD
    const lam = lon * DEG2RAD
    const cp = Math.cos(phi)
    targetDir.current.set(cp * Math.cos(lam), Math.sin(phi), -cp * Math.sin(lam)).normalize()
    settling.current = true
  }, [active, lat, lon, signal])

  useFrame((_, dtRaw) => {
    if (!settling.current) return
    const controls = controlsRef.current
    if (!controls) return
    const dt = Math.min(dtRaw, 0.05)
    const dist = camera.position.length()
    curDir.current.copy(camera.position).normalize()
    curDir.current.lerp(targetDir.current, 1 - Math.exp(-3.2 * dt)).normalize()
    camera.position.copy(curDir.current).multiplyScalar(dist)
    controls.target.set(0, 0, 0)
    controls.update()
    if (curDir.current.angleTo(targetDir.current) < 0.004) settling.current = false
  })

  return null
}
