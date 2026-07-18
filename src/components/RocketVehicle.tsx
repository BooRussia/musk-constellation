import { forwardRef, useImperativeHandle, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// Compact Falcon-style rocket for launch replay / live sim.
// Procedural primitives (no GLTF). Local +Y = nose; parent aims along path.
// Animated additive plume driven by setThrust(0–1).

export interface RocketVehicleHandle {
  setAccent: (color: string, intensity: number) => void
  resetAccent: () => void
  /** 0 = coast / cutoff, 1 = full first-stage burn. */
  setThrust: (amount: number) => void
}

const BODY = '#e8eef5'
const NOSE = '#f8fafc'
const FIN = '#94a3b8'
const ENGINE = '#1e293b'
const INTERSTAGE = '#475569'
const LEG = '#334155'

const RocketVehicle = forwardRef<RocketVehicleHandle>(function RocketVehicle(_, ref) {
  const glowMatRef = useRef<THREE.MeshBasicMaterial>(null)
  const glowMeshRef = useRef<THREE.Mesh>(null)
  const plumeOuterMat = useRef<THREE.MeshBasicMaterial>(null)
  const plumeCoreMat = useRef<THREE.MeshBasicMaterial>(null)
  const plumeOuter = useRef<THREE.Mesh>(null)
  const plumeCore = useRef<THREE.Mesh>(null)
  const lightRef = useRef<THREE.PointLight>(null)
  const thrustRef = useRef(0)
  const accentIntensity = useRef(0.75)
  const accentColor = useRef(new THREE.Color('#ff9a4a'))

  useImperativeHandle(ref, () => ({
    setAccent(color: string, intensity: number) {
      accentColor.current.set(color)
      accentIntensity.current = intensity
      if (glowMatRef.current) {
        glowMatRef.current.color.copy(accentColor.current)
        glowMatRef.current.opacity = 0.12 + intensity * 0.28
      }
      if (glowMeshRef.current) {
        glowMeshRef.current.scale.setScalar(0.7 + intensity * 0.55)
      }
    },
    resetAccent() {
      accentColor.current.set('#ff9a4a')
      accentIntensity.current = 0.75
      if (glowMatRef.current) {
        glowMatRef.current.color.set('#ff9a4a')
        glowMatRef.current.opacity = 0.18
      }
      if (glowMeshRef.current) glowMeshRef.current.scale.setScalar(1)
    },
    setThrust(amount: number) {
      thrustRef.current = THREE.MathUtils.clamp(amount, 0, 1)
    },
  }))

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const thrust = thrustRef.current
    const flicker = 0.88 + 0.12 * Math.sin(t * 42) + 0.06 * Math.sin(t * 97)
    const pulse = thrust * flicker

    if (plumeOuter.current && plumeOuterMat.current) {
      plumeOuter.current.visible = thrust > 0.02
      plumeOuter.current.scale.set(0.9 + pulse * 0.35, 0.75 + pulse * 0.9, 0.9 + pulse * 0.35)
      plumeOuterMat.current.color.copy(accentColor.current)
      plumeOuterMat.current.opacity = 0.22 + pulse * 0.45 * accentIntensity.current
    }
    if (plumeCore.current && plumeCoreMat.current) {
      plumeCore.current.visible = thrust > 0.02
      plumeCore.current.scale.set(0.85 + pulse * 0.25, 0.7 + pulse * 1.1, 0.85 + pulse * 0.25)
      plumeCoreMat.current.opacity = 0.35 + pulse * 0.55
    }
    if (lightRef.current) {
      lightRef.current.intensity = pulse * 0.85 * accentIntensity.current
      lightRef.current.color.copy(accentColor.current)
      lightRef.current.visible = thrust > 0.04
    }
  })

  // Local +Y is "nose up". Parent rotates the group to point along velocity.
  return (
    <group scale={0.72}>
      <mesh ref={glowMeshRef} scale={1}>
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshBasicMaterial
          ref={glowMatRef}
          color="#ff9a4a"
          transparent
          opacity={0.18}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Second stage / fairing */}
      <mesh position={[0, 0.028, 0]}>
        <cylinderGeometry args={[0.011, 0.0125, 0.038, 12]} />
        <meshBasicMaterial color={BODY} toneMapped={false} />
      </mesh>

      {/* Interstage */}
      <mesh position={[0, 0.004, 0]}>
        <cylinderGeometry args={[0.013, 0.013, 0.008, 12]} />
        <meshBasicMaterial color={INTERSTAGE} toneMapped={false} />
      </mesh>

      {/* First stage */}
      <mesh position={[0, -0.022, 0]}>
        <cylinderGeometry args={[0.013, 0.0145, 0.048, 12]} />
        <meshBasicMaterial color={BODY} toneMapped={false} />
      </mesh>

      {/* Nose cone */}
      <mesh position={[0, 0.058, 0]}>
        <coneGeometry args={[0.011, 0.03, 12]} />
        <meshBasicMaterial color={NOSE} toneMapped={false} />
      </mesh>

      {/* Engine bell */}
      <mesh position={[0, -0.052, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.012, 0.016, 10]} />
        <meshBasicMaterial color={ENGINE} toneMapped={false} />
      </mesh>

      {/* Outer plume */}
      <mesh ref={plumeOuter} position={[0, -0.078, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.014, 0.055, 10]} />
        <meshBasicMaterial
          ref={plumeOuterMat}
          color="#ff9a4a"
          transparent
          opacity={0.4}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Hot core */}
      <mesh ref={plumeCore} position={[0, -0.07, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.006, 0.038, 8]} />
        <meshBasicMaterial
          ref={plumeCoreMat}
          color="#fff4c8"
          transparent
          opacity={0.55}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <pointLight
        ref={lightRef}
        position={[0, -0.06, 0]}
        color="#ff9a4a"
        intensity={0}
        distance={0.55}
        decay={2}
      />

      {/* Grid fins (4) */}
      {(
        [
          [0.015, -0.008, 0, 0, 0, 0],
          [-0.015, -0.008, 0, 0, 0, 0],
          [0, -0.008, 0.015, 0, Math.PI / 2, 0],
          [0, -0.008, -0.015, 0, Math.PI / 2, 0],
        ] as const
      ).map(([x, y, z, rx, ry, rz], i) => (
        <mesh key={i} position={[x, y, z]} rotation={[rx, ry, rz]}>
          <boxGeometry args={[0.0018, 0.014, 0.012]} />
          <meshBasicMaterial color={FIN} toneMapped={false} />
        </mesh>
      ))}

      {/* Landing legs */}
      {(
        [
          [0.017, -0.038, 0, 0, 0, 0.4],
          [-0.017, -0.038, 0, 0, 0, -0.4],
          [0, -0.038, 0.017, -0.4, 0, 0],
          [0, -0.038, -0.017, 0.4, 0, 0],
        ] as const
      ).map(([x, y, z, rx, ry, rz], i) => (
        <mesh key={`leg-${i}`} position={[x, y, z]} rotation={[rx, ry, rz]}>
          <boxGeometry args={[0.0022, 0.018, 0.009]} />
          <meshBasicMaterial color={LEG} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
})

export default RocketVehicle
