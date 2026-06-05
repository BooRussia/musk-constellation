import { Crosshair, Orbit, Rocket } from 'lucide-react'
import MenuDropdown from './MenuDropdown'

interface Props {
  issActive: boolean
  onTrackISS: () => void
}

/**
 * Trackers menu — "fly the camera to and follow a live object" actions.
 * ISS is live; SpaceX Launches is the next tracker to land here.
 */
export default function TrackersMenu({ issActive, onTrackISS }: Props) {
  return (
    <MenuDropdown
      icon={Crosshair}
      label="Trackers"
      badge={issActive ? 1 : 0}
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

      <button type="button" className="layers-row layers-row--soon" disabled title="Coming soon">
        <Rocket className="layers-row-icon h-4 w-4" aria-hidden="true" />
        <span className="layers-row-label">SpaceX Launches</span>
        <span className="layers-soon">SOON</span>
      </button>
    </MenuDropdown>
  )
}
