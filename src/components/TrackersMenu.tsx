import { CalendarDays, ChevronRight, Crosshair, History, Orbit, Rocket } from 'lucide-react'
import MenuDropdown from './MenuDropdown'

interface Props {
  issActive: boolean
  onTrackISS: () => void
  launchActive: boolean
  onTrackLaunch: () => void
  onOpenReplays: () => void
  onOpenUpcoming: () => void
}

/**
 * Trackers menu — fly the camera to live objects, upcoming board, past replays.
 */
export default function TrackersMenu({
  issActive,
  onTrackISS,
  launchActive,
  onTrackLaunch,
  onOpenReplays,
  onOpenUpcoming,
}: Props) {
  const count = (issActive ? 1 : 0) + (launchActive ? 1 : 0)
  return (
    <MenuDropdown
      icon={Crosshair}
      label="Trackers"
      badge={count}
      title="Live trackers — fly the camera to objects in orbit"
    >
      <button
        type="button"
        className={`layers-row ${issActive ? 'layers-row--on' : ''}`}
        onClick={onTrackISS}
        aria-pressed={issActive}
        title="Zoom in and follow the ISS as it sweeps through orbit"
      >
        <Orbit className="layers-row-icon h-4 w-4" aria-hidden="true" />
        <span className="layers-row-label">{issActive ? 'Following ISS' : 'Follow the ISS'}</span>
        <span className={`layers-switch ${issActive ? 'is-on' : ''}`} />
      </button>

      <button
        type="button"
        className={`layers-row ${launchActive ? 'layers-row--on' : ''}`}
        onClick={onTrackLaunch}
        aria-pressed={launchActive}
        title="Track the next SpaceX launch — spin to the pad, watch, follow ascent"
      >
        <Rocket className="layers-row-icon h-4 w-4" aria-hidden="true" />
        <span className="layers-row-label">SpaceX Launches</span>
        <span className={`layers-switch ${launchActive ? 'is-on' : ''}`} />
      </button>

      <button
        type="button"
        className="layers-row"
        onClick={onOpenUpcoming}
        title="Browse the next few SpaceX flights and focus a pad"
      >
        <CalendarDays className="layers-row-icon h-4 w-4" aria-hidden="true" />
        <span className="layers-row-label">Upcoming flights</span>
        <ChevronRight className="h-4 w-4" aria-hidden="true" style={{ opacity: 0.5 }} />
      </button>

      <button
        type="button"
        className="layers-row"
        onClick={onOpenReplays}
        title="Replay a past SpaceX launch's flight path on the globe"
      >
        <History className="layers-row-icon h-4 w-4" aria-hidden="true" />
        <span className="layers-row-label">Past launches</span>
        <ChevronRight className="h-4 w-4" aria-hidden="true" style={{ opacity: 0.5 }} />
      </button>
    </MenuDropdown>
  )
}
