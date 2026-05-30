import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Satellite } from 'lucide-react'
import type { SatelliteHit } from './SatelliteCloud'

// ============================================
// Hover tooltip
// ============================================
// Follows the cursor with a small offset, fades in/out via
// framer-motion. Positioned in viewport coordinates (clientX/Y from
// the SatelliteHit). Pointer events are disabled so the tooltip
// never intercepts the next hover or click.
//
// Edge handling: when the cursor is close to the right or bottom
// edge of the viewport, flip the offset so the tooltip stays fully
// on-screen.

const OFFSET_X = 16
const OFFSET_Y = 16
// Conservative bounding box for the tooltip — used to flip its
// position near viewport edges. Real measured size is around
// 220 × 150, leaving a 16-px breathing margin.
const ESTIMATED_W = 240
const ESTIMATED_H = 180

interface Props {
  hit: SatelliteHit
  /** When true the tooltip is suppressed (e.g. user pinned the same
   *  sat, so the pinned card is the source of truth). */
  hidden?: boolean
}

export default function SatelliteTooltip({ hit, hidden = false }: Props) {
  // Compute final position once per hit so we don't recompute on
  // every framer animation frame.
  const { left, top } = useMemo(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
    const vh = typeof window !== 'undefined' ? window.innerHeight : 768
    let l = hit.clientX + OFFSET_X
    let t = hit.clientY + OFFSET_Y
    if (l + ESTIMATED_W > vw) l = hit.clientX - OFFSET_X - ESTIMATED_W
    if (t + ESTIMATED_H > vh) t = hit.clientY - OFFSET_Y - ESTIMATED_H
    return { left: Math.max(8, l), top: Math.max(8, t) }
  }, [hit.clientX, hit.clientY])

  if (hidden) return null

  const constellation = hit.entry.constellation === 'starlink' ? 'Starlink' : 'OneWeb'
  const dotColor = hit.entry.constellation === 'starlink' ? '#7ab8ff' : '#ffc94a'

  return (
    <motion.div
      className="sat-tooltip"
      style={{ left, top }}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
    >
      <div className="sat-tooltip-header">
        <Satellite className="sat-tooltip-icon" aria-hidden="true" />
        <span className="sat-tooltip-name">{hit.entry.name}</span>
      </div>
      <div className="sat-tooltip-constellation">
        <span className="sat-tooltip-dot" style={{ background: dotColor, boxShadow: `0 0 6px ${dotColor}` }} />
        <span>{constellation}</span>
        <span className="sat-tooltip-norad">#{hit.entry.noradId}</span>
      </div>
      <dl className="sat-tooltip-grid">
        <dt>ALT</dt>
        <dd>{hit.altitudeKm.toFixed(0)} km</dd>
        <dt>VEL</dt>
        <dd>{hit.velocityKmS.toFixed(2)} km/s</dd>
        <dt>T</dt>
        <dd>{hit.periodMin.toFixed(1)} min</dd>
      </dl>
    </motion.div>
  )
}
