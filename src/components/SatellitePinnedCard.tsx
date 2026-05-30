import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Activity, Radio, Satellite, X } from 'lucide-react'
import { propagate } from 'satellite.js'
import type { SatelliteHit } from './SatelliteCloud'

// ============================================
// Pinned info card
// ============================================
// Persistent info panel docked under the top nav on the right. Holds
// the last-clicked sat. Live-refreshes altitude + velocity at 1 Hz
// so the user sees the orbit ticking (sats move ~7.5 km/s — interesting
// to watch the position update).
//
// Glass aesthetic to match the sidebar at left-bottom.

const EARTH_RADIUS_KM = 6371
const REFRESH_INTERVAL_MS = 1000

interface LiveOrbit {
  altitudeKm: number
  velocityKmS: number
}

interface Props {
  hit: SatelliteHit
  onClose: () => void
}

export default function SatellitePinnedCard({ hit, onClose }: Props) {
  // Live orbit state — initialised from the original hit, then ticked
  // every second so the user sees a moving altitude/velocity readout.
  // The StarlinkView keys this component by noradId, so a swap to a
  // different sat fully unmounts/remounts and the initial state above
  // re-reads from the new hit — no in-effect setState resync needed.
  const [live, setLive] = useState<LiveOrbit>(() => ({
    altitudeKm: hit.altitudeKm,
    velocityKmS: hit.velocityKmS,
  }))

  useEffect(() => {
    const id = setInterval(() => {
      const pv = propagate(hit.entry.satrec, new Date())
      let altitudeKm = hit.altitudeKm
      let velocityKmS = hit.velocityKmS
      if (pv?.position && typeof pv.position !== 'boolean') {
        altitudeKm = Math.hypot(pv.position.x, pv.position.y, pv.position.z) - EARTH_RADIUS_KM
      }
      if (pv?.velocity && typeof pv.velocity !== 'boolean') {
        velocityKmS = Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z)
      }
      setLive({ altitudeKm, velocityKmS })
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [hit.entry.satrec, hit.altitudeKm, hit.velocityKmS])

  const constellation = hit.entry.constellation === 'starlink' ? 'Starlink' : 'OneWeb'
  const sublabel =
    hit.entry.constellation === 'starlink'
      ? 'SpaceX broadband mesh'
      : 'LEO comms · Eutelsat'
  const dotColor = hit.entry.constellation === 'starlink' ? '#7ab8ff' : '#ffc94a'

  return (
    <motion.div
      className="sat-pinned"
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      role="dialog"
      aria-label={`Satellite ${hit.entry.name} info`}
    >
      <button
        type="button"
        className="sat-pinned-close"
        onClick={onClose}
        aria-label="Dismiss satellite info"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      <div className="sat-pinned-header">
        <Satellite className="sat-pinned-icon" aria-hidden="true" />
        <div className="sat-pinned-title-block">
          <span className="sat-pinned-eyebrow">SATELLITE</span>
          <span className="sat-pinned-name">{hit.entry.name}</span>
        </div>
      </div>

      <div className="sat-pinned-meta">
        <span
          className="sat-pinned-dot"
          style={{ background: dotColor, boxShadow: `0 0 8px ${dotColor}` }}
        />
        <div className="sat-pinned-meta-text">
          <span className="sat-pinned-constellation">{constellation}</span>
          <span className="sat-pinned-sublabel">{sublabel}</span>
        </div>
        <span className="sat-pinned-norad">#{hit.entry.noradId}</span>
      </div>

      <dl className="sat-pinned-stats">
        <div className="sat-pinned-stat">
          <dt>
            <Activity className="sat-pinned-stat-icon" aria-hidden="true" />
            <span>Altitude</span>
          </dt>
          <dd>
            <span className="sat-pinned-value">{live.altitudeKm.toFixed(1)}</span>
            <span className="sat-pinned-unit">km</span>
          </dd>
        </div>
        <div className="sat-pinned-stat">
          <dt>
            <Radio className="sat-pinned-stat-icon" aria-hidden="true" />
            <span>Velocity</span>
          </dt>
          <dd>
            <span className="sat-pinned-value">{live.velocityKmS.toFixed(2)}</span>
            <span className="sat-pinned-unit">km/s</span>
          </dd>
        </div>
        <div className="sat-pinned-stat">
          <dt>
            <Satellite className="sat-pinned-stat-icon" aria-hidden="true" />
            <span>Period</span>
          </dt>
          <dd>
            <span className="sat-pinned-value">{hit.periodMin.toFixed(1)}</span>
            <span className="sat-pinned-unit">min</span>
          </dd>
        </div>
      </dl>
    </motion.div>
  )
}
