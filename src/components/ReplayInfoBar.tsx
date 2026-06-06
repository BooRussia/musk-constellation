import { History, Rocket } from 'lucide-react'
import type { PastLaunch } from '../lib/pastLaunches'

// Top info bar for a past-launch replay: the ship (rocket) + its payload
// (mission), plus orbit, date, and booster recovery. Mirrors the live
// launch ticker's look; the transport controls live in the bottom bar.

const ORBIT_FULL: Record<string, string> = {
  LEO: 'Low Earth Orbit',
  SSO: 'Sun-synchronous',
  GTO: 'Geo Transfer',
  MEO: 'Medium Earth Orbit',
  Sub: 'Suborbital',
  'N/A': '—',
}

function boosterText(l: PastLaunch): { label: string; title: string } | null {
  const b = l.landing
  if (!b) return null
  if (b.success === false) return { label: 'Booster lost', title: b.location || 'Landing failed' }
  const kind = b.type === 'RTLS' ? 'Ground-pad landing' : 'Droneship landing'
  return { label: kind, title: b.location || kind }
}

interface Props {
  launch: PastLaunch
}

export default function ReplayInfoBar({ launch }: Props) {
  const date = new Date(launch.net).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  const booster = boosterText(launch)

  return (
    <div className="launchbar replay-infobar">
      <div className="launchbar-id">
        <Rocket className="launchbar-rocket-icon h-4 w-4" aria-hidden="true" />
        <div className="launchbar-id-text">
          <div className="launchbar-mission">{launch.mission}</div>
          <div className="launchbar-sub">{launch.rocket}</div>
        </div>
      </div>

      <span className="launchbar-divider" />

      <div className="launchbar-stats">
        <div className="launchbar-stat">
          <span className="launchbar-stat-k">Orbit</span>
          <span className="launchbar-stat-v" title={ORBIT_FULL[launch.orbit] ?? ''}>
            {launch.orbit}
          </span>
        </div>
        {launch.missionType && (
          <div className="launchbar-stat">
            <span className="launchbar-stat-k">Payload</span>
            <span className="launchbar-stat-v">{launch.missionType}</span>
          </div>
        )}
        <div className="launchbar-stat">
          <span className="launchbar-stat-k">Date</span>
          <span className="launchbar-stat-v">{date}</span>
        </div>
        {booster && (
          <div className="launchbar-stat">
            <span className="launchbar-stat-k">Booster</span>
            <span className="launchbar-stat-v" title={booster.title}>
              {booster.label}
            </span>
          </div>
        )}
      </div>

      <div className="launchbar-actions">
        <span className="replay-infobar-tag">
          <History className="h-3 w-3" aria-hidden="true" /> Replay
        </span>
      </div>
    </div>
  )
}
