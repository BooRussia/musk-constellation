import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { propagate, gstime, eciToEcf, type SatRec } from 'satellite.js'
import { DOCKED_CREW_DRAGON } from '../data/iss'

// ============================================
// ISS TRACKER — live station marker
// ============================================
// Propagates the ISS from its TLE with the same SGP4 pipeline as the
// satellite cloud, drops a labelled marker at its live position, and (if a
// Crew Dragon is docked) tags it. Hidden when the Earth occludes the line
// of sight. Live altitude/speed are written to a shared ref so the info
// card can read them on a 1 Hz timer without re-rendering every frame.

const EARTH_RADIUS_KM = 6371
const EARTH_RADIUS_SCENE = 5
const KM_TO_SCENE = EARTH_RADIUS_SCENE / EARTH_RADIUS_KM

export interface ISSTelemetry {
  altKm: number
  speedKms: number
  hasFix: boolean
}

/** True if the Earth sphere (radius 5) blocks the segment camera→point.
 *  Ray-sphere: occluded only when the NEAR intersection lies strictly
 *  between the camera and the point (so a point on the near surface — its
 *  own intersection ≈ segment end — is treated as visible). */
function occludedByEarth(
  cam: THREE.Vector3,
  point: THREE.Vector3,
  dirTmp: THREE.Vector3,
): boolean {
  dirTmp.copy(point).sub(cam)
  const segLen = dirTmp.length()
  if (segLen < 1e-6) return false
  dirTmp.multiplyScalar(1 / segLen)
  const b = cam.dot(dirTmp)
  const c = cam.lengthSq() - EARTH_RADIUS_SCENE * EARTH_RADIUS_SCENE
  const disc = b * b - c
  if (disc <= 0) return false // line of sight misses the Earth
  const tNear = -b - Math.sqrt(disc)
  return tNear > 1e-3 && tNear < segLen - 1e-3
}

interface Props {
  satrec: SatRec
  telemetryRef: React.MutableRefObject<ISSTelemetry>
  /** Optional — receives the ISS world position each frame (for follow-cam). */
  posRef?: React.MutableRefObject<THREE.Vector3 | null>
}

export default function ISSTracker({ satrec, telemetryRef, posRef }: Props) {
  const groupRef = useRef<THREE.Group>(null)
  const markerRef = useRef<HTMLDivElement>(null)
  const pos = useRef(new THREE.Vector3())
  const dirTmp = useRef(new THREE.Vector3())

  useFrame(({ camera }) => {
    const group = groupRef.current
    if (!group) return
    const now = new Date()
    const pv = propagate(satrec, now)
    if (!pv?.position || typeof pv.position === 'boolean') {
      telemetryRef.current.hasFix = false
      return
    }
    const gmst = gstime(now)
    const ecf = eciToEcf(pv.position, gmst)
    pos.current.set(ecf.x, ecf.z, -ecf.y).multiplyScalar(KM_TO_SCENE)
    group.position.copy(pos.current)
    if (posRef) {
      if (!posRef.current) posRef.current = pos.current.clone()
      else posRef.current.copy(pos.current)
    }

    telemetryRef.current.altKm =
      Math.hypot(pv.position.x, pv.position.y, pv.position.z) - EARTH_RADIUS_KM
    if (pv.velocity && typeof pv.velocity !== 'boolean') {
      telemetryRef.current.speedKms = Math.hypot(
        pv.velocity.x,
        pv.velocity.y,
        pv.velocity.z,
      )
    }
    telemetryRef.current.hasFix = true

    const el = markerRef.current
    if (el) {
      const want = occludedByEarth(camera.position, pos.current, dirTmp.current) ? 'none' : ''
      if (el.style.display !== want) el.style.display = want
    }
  })

  return (
    <group ref={groupRef}>
      <Html
        center
        zIndexRange={[14, 0]}
        style={{ pointerEvents: 'none' }}
        wrapperClass="iss-wrapper"
      >
        <div ref={markerRef} className="iss-marker">
          <span className="iss-ping" />
          <span className="iss-dot" />
          <span className="iss-label">
            ISS
            {DOCKED_CREW_DRAGON && <span className="iss-badge">+ Crew Dragon</span>}
          </span>
        </div>
      </Html>
    </group>
  )
}
