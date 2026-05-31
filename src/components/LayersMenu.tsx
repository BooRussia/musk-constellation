import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronDown,
  Grid3x3,
  Layers,
  LayoutGrid,
  Rocket,
  RotateCw,
  Spline,
  Sun,
  type LucideIcon,
} from 'lucide-react'
import { TILE_PROVIDERS, TILE_PROVIDER_ORDER, type TileProvider } from '../lib/tiles'

interface Props {
  borders: boolean
  onBorders: () => void
  graticule: boolean
  onGraticule: () => void
  launchSites: boolean
  onLaunchSites: () => void
  detailTiles: boolean
  onDetailTiles: () => void
  tileProvider: TileProvider
  onTileProvider: (p: TileProvider) => void
  fullSun: boolean
  onFullSun: () => void
  autoRotate: boolean
  onAutoRotate: () => void
  speedLabel: string
  onCycleSpeed: () => void
}

/**
 * Layers menu — one dropdown that holds every map overlay + display
 * toggle, so the top bar stays clean instead of a row of loose buttons.
 * Drops a panel of toggle rows down the right side, like the map-style
 * picker.
 */
export default function LayersMenu({
  borders,
  onBorders,
  graticule,
  onGraticule,
  launchSites,
  onLaunchSites,
  detailTiles,
  onDetailTiles,
  tileProvider,
  onTileProvider,
  fullSun,
  onFullSun,
  autoRotate,
  onAutoRotate,
  speedLabel,
  onCycleSpeed,
}: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const overlays: { label: string; icon: LucideIcon; on: boolean; toggle: () => void }[] = [
    { label: 'Borders', icon: Spline, on: borders, toggle: onBorders },
    { label: 'Lat / long grid', icon: Grid3x3, on: graticule, toggle: onGraticule },
    { label: 'Launch sites', icon: Rocket, on: launchSites, toggle: onLaunchSites },
  ]
  const activeCount =
    [borders, graticule, launchSites, detailTiles, fullSun, autoRotate].filter(Boolean)
      .length

  return (
    <div className="layers" ref={ref}>
      <button
        type="button"
        className={`layers-trigger ${open ? 'layers-trigger--open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        title="Map layers & display options"
      >
        <Layers className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="layers-trigger-label">Layers</span>
        {activeCount > 0 && <span className="layers-badge">{activeCount}</span>}
        <ChevronDown className="layers-chevron h-3.5 w-3.5" aria-hidden="true" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="menu"
            className="layers-menu"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
          >
            <div className="layers-section-title">Overlays</div>
            {overlays.map((o) => {
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

            {/* High-res tile mosaic — streams in when you zoom in. When on,
                reveal a Satellite/Street source switch + attribution. */}
            <button
              type="button"
              className={`layers-row ${detailTiles ? 'layers-row--on' : ''}`}
              onClick={onDetailTiles}
              aria-pressed={detailTiles}
              title="Stream Google-Maps-style detail tiles as you zoom in"
            >
              <LayoutGrid className="layers-row-icon h-4 w-4" aria-hidden="true" />
              <span className="layers-row-label">Detail tiles</span>
              <span className={`layers-switch ${detailTiles ? 'is-on' : ''}`} />
            </button>
            <AnimatePresence initial={false}>
              {detailTiles && (
                <motion.div
                  key="tile-provider"
                  className="layers-sub"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <div className="layers-seg" role="group" aria-label="Tile imagery">
                    {TILE_PROVIDER_ORDER.map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={`layers-seg-btn ${tileProvider === p ? 'is-on' : ''}`}
                        onClick={() => onTileProvider(p)}
                        aria-pressed={tileProvider === p}
                      >
                        {TILE_PROVIDERS[p].label}
                      </button>
                    ))}
                  </div>
                  <div className="layers-credit">{TILE_PROVIDERS[tileProvider].attribution}</div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="layers-section-title">Display</div>
            <button
              type="button"
              className={`layers-row ${fullSun ? 'layers-row--on' : ''}`}
              onClick={onFullSun}
              aria-pressed={fullSun}
            >
              <Sun className="layers-row-icon h-4 w-4" aria-hidden="true" />
              <span className="layers-row-label">Full sun</span>
              <span className={`layers-switch ${fullSun ? 'is-on' : ''}`} />
            </button>
            <button
              type="button"
              className={`layers-row ${autoRotate ? 'layers-row--on' : ''}`}
              onClick={onAutoRotate}
              aria-pressed={autoRotate}
            >
              <RotateCw className="layers-row-icon h-4 w-4" aria-hidden="true" />
              <span className="layers-row-label">Auto-rotate</span>
              <span className={`layers-switch ${autoRotate ? 'is-on' : ''}`} />
            </button>
            <AnimatePresence initial={false}>
              {autoRotate && (
                <motion.button
                  key="speed"
                  type="button"
                  className="layers-speed-row"
                  onClick={onCycleSpeed}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  title="Rotation speed"
                >
                  <span className="layers-speed-label">Rotation speed</span>
                  <span className="layers-speed-val">{speedLabel}</span>
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
