import { Grid3x3, Layers, Rocket, Spline, type LucideIcon } from 'lucide-react'
import MenuDropdown from './MenuDropdown'

interface Props {
  borders: boolean
  onBorders: () => void
  graticule: boolean
  onGraticule: () => void
  launchSites: boolean
  onLaunchSites: () => void
}

/**
 * Layers menu — the map OVERLAYS that sit on the globe surface (borders,
 * graticule, launch sites). Visual/display options live in the separate
 * Visuals menu next to it.
 */
export default function LayersMenu({
  borders,
  onBorders,
  graticule,
  onGraticule,
  launchSites,
  onLaunchSites,
}: Props) {
  const rows: { label: string; icon: LucideIcon; on: boolean; toggle: () => void }[] = [
    { label: 'Borders', icon: Spline, on: borders, toggle: onBorders },
    { label: 'Lat / long grid', icon: Grid3x3, on: graticule, toggle: onGraticule },
    { label: 'Launch sites', icon: Rocket, on: launchSites, toggle: onLaunchSites },
  ]
  const activeCount = rows.filter((r) => r.on).length

  return (
    <MenuDropdown icon={Layers} label="Layers" badge={activeCount} title="Map overlays">
      {rows.map((o) => {
        const Icon = o.icon
        return (
          <button
            key={o.label}
            type="button"
            className={`layers-row ${o.on ? 'layers-row--on' : ''}`}
            onClick={o.toggle}
            aria-pressed={o.on}
          >
            <Icon className="layers-row-icon h-4 w-4" aria-hidden="true" />
            <span className="layers-row-label">{o.label}</span>
            <span className={`layers-switch ${o.on ? 'is-on' : ''}`} />
          </button>
        )
      })}
    </MenuDropdown>
  )
}
