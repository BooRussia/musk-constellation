import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { ISS_STATUS, DOCKED_CREW_DRAGON } from '../data/iss'
import type { ISSTelemetry } from './ISSTracker'

interface Props {
  telemetryRef: React.MutableRefObject<ISSTelemetry>
  /** Show altitude in miles + speed in mph instead of km / km·s. */
  imperial: boolean
}

// Collapsed by default on phones (so it doesn't swallow the screen next to
// the launch card), expanded on desktop. Read once at module scope.
const DEFAULT_OPEN = typeof window === 'undefined' ? true : window.innerWidth > 639

/**
 * Live ISS readout — altitude/speed (sampled from the tracker's shared
 * telemetry ref at 1 Hz) plus the curated expedition + docked Crew Dragon.
 * Collapsible: the header always shows a compact live altitude.
 */
export default function ISSInfoCard({ telemetryRef, imperial }: Props) {
  const [tele, setTele] = useState<ISSTelemetry>({ altKm: 0, speedKms: 0, hasFix: false })
  const [open, setOpen] = useState(DEFAULT_OPEN)

  useEffect(() => {
    const id = window.setInterval(() => {
      const t = telemetryRef.current
      setTele({ altKm: t.altKm, speedKms: t.speedKms, hasFix: t.hasFix })
    }, 1000)
    return () => window.clearInterval(id)
  }, [telemetryRef])

  return (
    <div className={`iss-card ${open ? '' : 'iss-card--collapsed'}`}>
      <button
        type="button"
        className="iss-card-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="iss-card-live" aria-hidden="true">
          ●
        </span>
        <span className="iss-card-title">INTL. SPACE STATION</span>
        {!open && (
          <span className="iss-card-mini">
            {tele.hasFix ? `${Math.round(tele.altKm)} km` : '—'}
          </span>
        )}
        <ChevronDown className={`iss-card-chev ${open ? 'is-open' : ''}`} aria-hidden="true" />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="iss-card-stats">
              <div>
                <b>
                  {tele.hasFix
                    ? Math.round(tele.altKm * (imperial ? 0.621371 : 1)).toLocaleString()
                    : '—'}
                </b>
                <span>{imperial ? 'mi altitude' : 'km altitude'}</span>
              </div>
              <div>
                <b>
                  {tele.hasFix
                    ? imperial
                      ? Math.round(tele.speedKms * 2236.94).toLocaleString()
                      : tele.speedKms.toFixed(2)
                    : '—'}
                </b>
                <span>{imperial ? 'mph' : 'km / s'}</span>
              </div>
            </div>

            <div className="iss-card-crew">
              <div className="iss-card-exp">{ISS_STATUS.expedition}</div>
              {DOCKED_CREW_DRAGON ? (
                <>
                  <div className="iss-card-dragon">
                    🚀 {DOCKED_CREW_DRAGON.mission} · {DOCKED_CREW_DRAGON.capsule}
                  </div>
                  <div className="iss-card-names">{DOCKED_CREW_DRAGON.crew.join(' · ')}</div>
                </>
              ) : (
                <div className="iss-card-dragon">No Crew Dragon currently docked</div>
              )}
            </div>

            <div className="iss-card-asof">crew data as of {ISS_STATUS.asOf}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
