import { useEffect, useState } from 'react'
import { ISS_STATUS, DOCKED_CREW_DRAGON } from '../data/iss'
import type { ISSTelemetry } from './ISSTracker'

interface Props {
  telemetryRef: React.MutableRefObject<ISSTelemetry>
}

/**
 * Small live readout for the ISS — altitude/speed (sampled from the
 * tracker's shared telemetry ref at 1 Hz so the per-frame propagation
 * never re-renders React) plus the curated expedition + docked Crew
 * Dragon context.
 */
export default function ISSInfoCard({ telemetryRef }: Props) {
  const [tele, setTele] = useState<ISSTelemetry>({ altKm: 0, speedKms: 0, hasFix: false })

  useEffect(() => {
    const id = window.setInterval(() => {
      const t = telemetryRef.current
      setTele({ altKm: t.altKm, speedKms: t.speedKms, hasFix: t.hasFix })
    }, 1000)
    return () => window.clearInterval(id)
  }, [telemetryRef])

  return (
    <div className="iss-card">
      <div className="iss-card-head">
        <span className="iss-card-live" aria-hidden="true">●</span>
        <span>INTL. SPACE STATION</span>
      </div>

      <div className="iss-card-stats">
        <div>
          <b>{tele.hasFix ? Math.round(tele.altKm).toLocaleString() : '—'}</b>
          <span>km altitude</span>
        </div>
        <div>
          <b>{tele.hasFix ? tele.speedKms.toFixed(2) : '—'}</b>
          <span>km / s</span>
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
    </div>
  )
}
