import { forwardRef, useImperativeHandle, useRef } from 'react'
import * as THREE from 'three'

// Compact Falcon-style rocket marker for the launch replay vehicle.
// Built from primitives so we stay dependency-free; oriented by the parent.

export interface RocketVehicleHandle {
  setAccent: (color: string, intensity: number) => void
  resetAccent: () => void
}

const BODY = '#e8eef5'
const NOSE = '#f8fafc'
const FIN = '#94a3b8'
const ENGINE = '#1e293b'

const RocketVehicle = forwardRef<RocketVehicleHandle>(function RocketVehicle(_, ref) {
  const glowMatRef = useRef<THREE.MeshBasicMaterial>(null)
  const plumeMatRef = useRef<THREE.MeshBasicMaterial>(null)
  const glowMeshRef = useRef<THREE.Mesh>(null)

  useImperativeHandle(ref, () => ({
    setAccent(color: string, intensity: number) {
      const col = new THREE.Color(color)
      if (glowMatRef.current) {
        glowMatRef.current.color.copy(col)
        glowMatRef.current.opacity = 0.12 + intensity * 0.28
      }
      if (plumeMatRef.current) {
        plumeMatRef.current.color.copy(col)
        plumeMatRef.current.opacity = 0.35 + intensity * 0.45
      }
      if (glowMeshRef.current) {
        const s = 0.7 + intensity * 0.55
        glowMeshRef.current.scale.setScalar(s)
      }
    },
    resetAccent() {
      if (glowMatRef.current) {
        glowMatRef.current.color.set('#ff9a4a')
        glowMatRef.current.opacity = 0.18
      }
      if (plumeMatRef.current) {
        plumeMatRef.current.color.set('#ff9a4a')
        plumeMatRef.current.opacity = 0.45
      }
      if (glowMeshRef.current) glowMeshRef.current.scale.setScalar(1)
    },
  }))

  // Local +Y is "nose up". Parent rotates the group to point along velocity.
  return (
    <group scale={0.55}>
      {/* Soft stage-tinted halo — kept small so the rocket silhouette reads. */}
      <mesh ref={glowMeshRef} scale={1}>
        <sphereGeometry args={[0.055, 12, 12]} />
        <meshBasicMaterial
          ref={glowMatRef}
          color="#ff9a4a"
          transparent
          opacity={0.18}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Fuselage */}
      <mesh position={[0, 0.01, 0]}>
        <cylinderGeometry args={[0.012, 0.014, 0.055, 10]} />
        <meshBasicMaterial color={BODY} toneMapped={false} />
      </mesh>

      {/* Interstage band */}
      <mesh position={[0, -0.005, 0]}>
        <cylinderGeometry args={[0.0142, 0.0142, 0.006, 10]} />
        <meshBasicMaterial color="#64748b" toneMapped={false} />
      </mesh>

      {/* Nose cone */}
      <mesh position={[0, 0.048, 0]}>
        <coneGeometry args={[0.012, 0.028, 10]} />
        <meshBasicMaterial color={NOSE} toneMapped={false} />
      </mesh>

      {/* Engine bell */}
      <mesh position={[0, -0.024, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.011, 0.014, 8]} />
        <meshBasicMaterial color={ENGINE} toneMapped={false} />
      </mesh>

      {/* Exhaust plume */}
      <mesh position={[0, -0.042, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.008, 0.028, 8]} />
        <meshBasicMaterial
          ref={plumeMatRef}
          color="#ff9a4a"
          transparent
          opacity={0.45}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Grid fins (4) */}
      {(
        [
          [0.014, -0.012, 0, 0, 0, 0],
          [-0.014, -0.012, 0, 0, 0, 0],
          [0, -0.012, 0.014, 0, Math.PI / 2, 0],
          [0, -0.012, -0.014, 0, Math.PI / 2, 0],
        ] as const
      ).map(([x, y, z, rx, ry, rz], i) => (
        <mesh key={i} position={[x, y, z]} rotation={[rx, ry, rz]}>
          <boxGeometry args={[0.0015, 0.012, 0.01]} />
          <meshBasicMaterial color={FIN} toneMapped={false} />
        </mesh>
      ))}

      {/* Landing-leg style fins near the base */}
      {(
        [
          [0.016, -0.02, 0, 0, 0, 0.35],
          [-0.016, -0.02, 0, 0, 0, -0.35],
          [0, -0.02, 0.016, -0.35, 0, 0],
          [0, -0.02, -0.016, 0.35, 0, 0],
        ] as const
      ).map(([x, y, z, rx, ry, rz], i) => (
        <mesh key={`leg-${i}`} position={[x, y, z]} rotation={[rx, ry, rz]}>
          <boxGeometry args={[0.002, 0.016, 0.008]} />
          <meshBasicMaterial color="#475569" toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
})

export default RocketVehicle
