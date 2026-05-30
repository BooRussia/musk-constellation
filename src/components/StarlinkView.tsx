import { lazy, Suspense } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Satellite } from 'lucide-react'

const EarthScene = lazy(() => import('./EarthScene'))

interface Props {
  onBack: () => void
}

/**
 * Starlink constellation view. Phase 1 ships the foundation:
 *   • To-scale photoreal Earth with atmosphere
 *   • Drag to rotate, scroll to zoom
 *   • Topnav with back-to-constellation
 *   • Status strip with active sat count (placeholder until
 *     phase 2 wires the CelesTrak TLE feed)
 *
 * Phase 2 adds live ~8.5k satellites via satellite.js + CelesTrak.
 * Phase 3 adds the launch-batch timeline mode.
 */
export default function StarlinkView({ onBack }: Props) {
  return (
    <div className="starlink-view">
      {/* Top chrome — minimal so the Earth gets visual priority. */}
      <header className="starlink-topnav">
        <button
          type="button"
          onClick={onBack}
          className="starlink-back"
          aria-label="Back to constellation"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Constellation</span>
        </button>

        <div className="starlink-brand">
          <span className="starlink-eyebrow">STARLINK</span>
          <h1 className="starlink-title">Orbital Constellation</h1>
        </div>

        <div className="starlink-status">
          <Satellite className="h-3 w-3" aria-hidden="true" />
          <span className="starlink-status-count">~8,500</span>
          <span className="starlink-status-label">tracked sats</span>
        </div>
      </header>

      <div className="starlink-canvas">
        <Suspense fallback={<StarlinkLoading />}>
          <EarthScene />
        </Suspense>
      </div>

      {/* Phase indicator — explicit so users see "more coming"
          rather than wondering where the satellites are. */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.4 }}
        className="starlink-roadmap glass panel"
      >
        <p className="starlink-roadmap-eyebrow">PHASE 1 · FOUNDATION</p>
        <p className="starlink-roadmap-body">
          Earth scene live. Next: real-time satellite tracking via CelesTrak
          TLEs, then timeline mode showing the constellation grow from 60
          sats in May 2019 to today.
        </p>
      </motion.div>
    </div>
  )
}

function StarlinkLoading() {
  return (
    <div className="starlink-loading">
      <div className="starlink-loading-orb" />
      <p>Loading Earth…</p>
    </div>
  )
}
