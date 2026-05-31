import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { LAUNCH_SITES, type LaunchSite } from '../data/launchSites'

// ============================================
// LAUNCH SITES — pulsing ground markers
// ============================================
// A glowing amber marker (with a radar-ping ring) at every worldwide
// rocket launch site, with the site name. Matches the GlobeLabels
// approach: per-frame DOM mutation for back-side occlusion + a name
// level-of-detail (tier-0 names always; tier-1 names appear as you zoom
// in). The marker dot always shows on the visible hemisphere.

const EARTH_RADIUS = 5
const MARKER_RADIUS = EARTH_RADIUS * 1.004
const DEG2RAD = Math.PI / 180

function latLonToScene(latDeg: number, lonDeg: number, radius: number): THREE.Vector3 {
  const phi = latDeg * DEG2RAD
  const lam = lonDeg * DEG2RAD
  const ex = Math.cos(phi) * Math.cos(lam)
  const ey = Math.cos(phi) * Math.sin(lam)
  const ez = Math.sin(phi)
  return new THREE.Vector3(ex, ez, -ey).multiplyScalar(radius)
}

/** tier-1 names appear once the camera is reasonably close. */
function maxNameTier(dist: number): number {
  return dist > 17 ? 0 : 1
}

interface Entry {
  data: LaunchSite
  pos: THREE.Vector3
  normal: THREE.Vector3
  el: HTMLDivElement | null
  labelEl: HTMLSpanElement | null
}

export default function LaunchSites() {
  const entries = useMemo<Entry[]>(
    () =>
      LAUNCH_SITES.map((data) => {
        const pos = latLonToScene(data.lat, data.lon, MARKER_RADIUS)
        return { data, pos, normal: pos.clone().normalize(), el: null, labelEl: null }
      }),
    [],
  )
  const entriesRef = useRef(entries)
  const camDir = useRef(new THREE.Vector3())

  useFrame(({ camera }) => {
    const dist = camera.position.length()
    const nameTier = maxNameTier(dist)
    camDir.current.copy(camera.position).normalize()

    for (const e of entriesRef.current) {
      const el = e.el
      if (!el) continue
      // Back-side occlusion (hide markers on the far hemisphere).
      const facing = e.normal.dot(camDir.current)
      if (facing <= 0.1) {
        if (el.style.display !== 'none') el.style.display = 'none'
        continue
      }
      if (el.style.display === 'none') el.style.display = ''
      const fade = THREE.MathUtils.clamp((facing - 0.1) / 0.18, 0, 1)
      el.style.opacity = fade.toFixed(2)
      // Name level-of-detail (the dot/ping stays; only the text gates).
      if (e.labelEl) {
        const want = e.data.tier <= nameTier ? '' : 'none'
        if (e.labelEl.style.display !== want) e.labelEl.style.display = want
      }
    }
  })

  return (
    <group>
      {entries.map((e, i) => (
        <Html
          key={`${e.data.name}-${i}`}
          position={e.pos}
          center
          zIndexRange={[12, 0]}
          style={{ pointerEvents: 'none' }}
          wrapperClass="launch-wrapper"
        >
          <div
            ref={(node) => {
              e.el = node
              entriesRef.current[i].el = node
            }}
            className="launch-marker"
            style={{ display: 'none' }}
            title={e.data.note}
          >
            <span className="launch-ping" />
            <span className="launch-dot" />
            <span
              ref={(node) => {
                e.labelEl = node
                entriesRef.current[i].labelEl = node
              }}
              className="launch-label"
            >
              {e.data.name}
            </span>
          </div>
        </Html>
      ))}
    </group>
  )
}
