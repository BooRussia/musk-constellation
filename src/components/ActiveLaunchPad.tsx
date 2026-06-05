import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'

// A bright, double-ringed pulse at the next launch's pad so the user can
// instantly spot where on the globe the launch is happening from.

const EARTH_RADIUS = 5
const MARKER_RADIUS = EARTH_RADIUS * 1.004
const DEG2RAD = Math.PI / 180

interface Props {
  lat: number
  lon: number
  name: string
}

export default function ActiveLaunchPad({ lat, lon, name }: Props) {
  const pos = useMemo(() => {
    const phi = lat * DEG2RAD
    const lam = lon * DEG2RAD
    const cp = Math.cos(phi)
    return new THREE.Vector3(cp * Math.cos(lam), Math.sin(phi), -cp * Math.sin(lam)).multiplyScalar(
      MARKER_RADIUS,
    )
  }, [lat, lon])
  const normal = useMemo(() => pos.clone().normalize(), [pos])
  const elRef = useRef<HTMLDivElement>(null)
  const camDir = useRef(new THREE.Vector3())

  useFrame(({ camera }) => {
    const el = elRef.current
    if (!el) return
    const facing = normal.dot(camDir.current.copy(camera.position).normalize())
    const want = facing <= 0.05 ? 'none' : ''
    if (el.style.display !== want) el.style.display = want
  })

  return (
    <Html
      position={pos}
      center
      zIndexRange={[13, 0]}
      style={{ pointerEvents: 'none' }}
      wrapperClass="launchpad-wrapper"
    >
      <div ref={elRef} className="launchpad-marker">
        <span className="launchpad-ping" />
        <span className="launchpad-ping launchpad-ping--2" />
        <span className="launchpad-dot" />
        <span className="launchpad-label">{name}</span>
      </div>
    </Html>
  )
}
