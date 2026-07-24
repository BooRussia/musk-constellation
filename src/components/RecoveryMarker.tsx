import { useMemo } from 'react'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { destPoint } from '../lib/trajectory'

// Modeled booster recovery marker — placed downrange along the launch
// azimuth at the baked / typical recovery distance. Not telemetry.

const EARTH_RADIUS = 5
const MARK_R = EARTH_RADIUS * 1.004
const RAD = Math.PI / 180
const EARTH_R_KM = 6371

function toScene(lat: number, lon: number): THREE.Vector3 {
  const phi = lat * RAD
  const lam = lon * RAD
  const cp = Math.cos(phi)
  return new THREE.Vector3(cp * Math.cos(lam), Math.sin(phi), -cp * Math.sin(lam)).multiplyScalar(
    MARK_R,
  )
}

interface Props {
  padLat: number
  padLon: number
  /** Launch azimuth deg from north. */
  azimuth: number
  /** Great-circle downrange to recovery (km). */
  downrangeKm: number
  /** ASDS / RTLS / Ocean label. */
  label?: string
}

export default function RecoveryMarker({
  padLat,
  padLon,
  azimuth,
  downrangeKm,
  label = 'Recovery',
}: Props) {
  const { pos, rangeKm } = useMemo(() => {
    const arcDeg = (downrangeKm / EARTH_R_KM) * (180 / Math.PI)
    const d = destPoint(padLat, padLon, azimuth, arcDeg)
    return { pos: toScene(d.lat, d.lon), rangeKm: Math.round(downrangeKm) }
  }, [padLat, padLon, azimuth, downrangeKm])

  return (
    <group position={pos}>
      <mesh>
        <sphereGeometry args={[0.018, 12, 12]} />
        <meshBasicMaterial color="#5eead4" toneMapped={false} />
      </mesh>
      <Html center zIndexRange={[12, 0]} style={{ pointerEvents: 'none' }} wrapperClass="recovery-wrap">
        <div className="recovery-label">
          <span className="recovery-verb">MODELED</span>
          <span className="recovery-name">{label}</span>
          <span className="recovery-range">{rangeKm.toLocaleString()} km downrange</span>
        </div>
      </Html>
    </group>
  )
}
