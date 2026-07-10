import { History, Play, Rocket } from 'lucide-react'
import type { PastLaunch } from '../lib/pastLaunches'
import { youtubeVideoId } from '../lib/youtubePlayer'

// Top info bar for a past-launch replay: the ship (rocket) + its payload
// (mission), plus orbit, date, and booster recovery. Optional Watch opens
// a synced SpaceX webcast mini-player when an embeddable YouTube VOD exists.

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
  /** Optional — opens the synced webcast mini-player when available. */
  onWatch?: () => void
  watchOpen?: boolean
}

export default function ReplayInfoBar({ launch, onWatch, watchOpen }: Props) {
  const date = new Date(launch.net).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  const booster = boosterText(launch)
  const canWatch = !!youtubeVideoId(launch.webcastEmbed ?? launch.webcastUrl)

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
        {canWatch && onWatch && (
          <button
            type="button"
            className={`launchbar-watch${watchOpen ? ' is-on' : ''}`}
            onClick={onWatch}
            aria-pressed={watchOpen}
            title={
              watchOpen
                ? 'Hide synced SpaceX webcast'
                : 'Watch the SpaceX webcast synced to this replay'
            }
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            {watchOpen ? 'Hide stream' : 'Watch'}
          </button>
        )}
        <span className="replay-infobar-tag">
          <History className="h-3 w-3" aria-hidden="true" /> Replay
        </span>
      </div>
    </div>
  )
}
