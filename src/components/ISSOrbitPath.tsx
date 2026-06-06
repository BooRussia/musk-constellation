import { useEffect, useMemo, useState } from 'react'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { propagate, gstime, eciToEcf, type SatRec } from 'satellite.js'

// ============================================
// ISS ORBIT PATH — ground track while following the station
// ============================================
// Samples the ISS's SGP4 orbit a half-period behind and a half-period ahead
// of "now" (in the same ECEF→scene frame as the marker), and draws it as two
// lines: a slightly thicker, solid line for where it's BEEN and a skinny,
// fainter line for where it's GOING. The window slides with real time
// (rebuilt ~1×/s). The track precesses because the scene is Earth-fixed and
// the Earth turns under the orbit.

const EARTH_RADIUS_KM = 6371
const EARTH_RADIUS_SCENE = 5
const KM_TO_SCENE = EARTH_RADIUS_SCENE / EARTH_RADIUS_KM
const SAMPLES = 96
const COLOR = '#8fd3ff'

function samplePath(satrec: SatRec, fromMs: number, toMs: number, n: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i < n; i++) {
    const t = new Date(fromMs + (toMs - fromMs) * (i / (n - 1)))
    const pv = propagate(satrec, t)
    if (!pv?.position || typeof pv.position === 'boolean') continue
    const ecf = eciToEcf(pv.position, gstime(t))
    pts.push(
      new THREE.Vector3(ecf.x * KM_TO_SCENE, ecf.z * KM_TO_SCENE, -ecf.y * KM_TO_SCENE),
    )
  }
  return pts
}

export default function ISSOrbitPath({ satrec }: { satrec: SatRec }) {
  // One orbital period (min → ms). satrec.no is radians/min.
  const halfPeriodMs = useMemo(() => {
    const min = satrec.no > 0 ? (2 * Math.PI) / satrec.no : 93
    return (min * 60000) / 2
  }, [satrec])

  const [paths, setPaths] = useState<{ past: THREE.Vector3[]; future: THREE.Vector3[] }>({
    past: [],
    future: [],
  })

  useEffect(() => {
    const build = () => {
      const now = Date.now()
      setPaths({
        past: samplePath(satrec, now - halfPeriodMs, now, SAMPLES),
        future: samplePath(satrec, now, now + halfPeriodMs, SAMPLES),
      })
    }
    build()
    const id = window.setInterval(build, 1000)
    return () => window.clearInterval(id)
  }, [satrec, halfPeriodMs])

  return (
    <group>
      {paths.past.length > 1 && (
        <Line
          points={paths.past}
          color={COLOR}
          lineWidth={2.4}
          transparent
          opacity={0.9}
          depthWrite={false}
        />
      )}
      {paths.future.length > 1 && (
        <Line
          points={paths.future}
          color={COLOR}
          lineWidth={1}
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      )}
    </group>
  )
}
