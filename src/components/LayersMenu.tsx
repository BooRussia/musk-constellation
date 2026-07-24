import { AnimatePresence, motion } from 'framer-motion'
import { Grid3x3, Layers, Orbit, Rocket, Spline, Type, type LucideIcon } from 'lucide-react'
import MenuDropdown from './MenuDropdown'

interface Props {
  borders: boolean
  onBorders: () => void
  graticule: boolean
  onGraticule: () => void
  launchSites: boolean
  onLaunchSites: () => void
  labels: boolean
  onLabels: () => void
  countryLabels: boolean
  onCountryLabels: () => void
  iss: boolean
  onIss: () => void
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
  labels,
  onLabels,
  countryLabels,
  onCountryLabels,
  iss,
  onIss,
}: Props) {
  const rows: { label: string; icon: LucideIcon; on: boolean; toggle: () => void; key: string }[] = [
    { key: 'labels', label: 'Place names', icon: Type, on: labels, toggle: onLabels },
    { key: 'borders', label: 'Borders', icon: Spline, on: borders, toggle: onBorders },
    { key: 'grid', label: 'Lat / long grid', icon: Grid3x3, on: graticule, toggle: onGraticule },
    { key: 'pads', label: 'Launch sites', icon: Rocket, on: launchSites, toggle: onLaunchSites },
    { key: 'iss', label: 'Space Station (ISS)', icon: Orbit, on: iss, toggle: onIss },
  ]
  const badgeCount =
    (labels ? 1 : 0) +
    (labels && countryLabels ? 1 : 0) +
    (borders ? 1 : 0) +
    (graticule ? 1 : 0) +
    (launchSites ? 1 : 0) +
    (iss ? 1 : 0)

  return (
    <MenuDropdown icon={Layers} label="Layers" badge={badgeCount} title="Map overlays">
      {rows.map((o) => {
        const Icon = o.icon
        return (
          <div key={o.key}>
            <button
              type="button"
              className={`layers-row ${o.on ? 'layers-row--on' : ''}`}
              onClick={o.toggle}
              aria-pressed={o.on}
            >
              <Icon className="layers-row-icon h-4 w-4" aria-hidden="true" />
              <span className="layers-row-label">{o.label}</span>
              <span className={`layers-switch ${o.on ? 'is-on' : ''}`} />
            </button>
            {o.key === 'labels' && (
              <AnimatePresence initial={false}>
                {labels && (
                  <motion.div
                    key="countries"
                    className="layers-sub"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                  >
                    <button
                      type="button"
                      className={`layers-row layers-row--nested ${countryLabels ? 'layers-row--on' : ''}`}
                      onClick={onCountryLabels}
                      aria-pressed={countryLabels}
                      title="Show country name labels on the globe"
                    >
                      <span className="layers-row-label">Countries</span>
                      <span className={`layers-switch ${countryLabels ? 'is-on' : ''}`} />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </div>
        )
      })}
    </MenuDropdown>
  )
}
