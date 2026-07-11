import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Download, Gauge, LayoutGrid, RotateCw, Sparkles, Sun, X } from 'lucide-react'
import MenuDropdown from './MenuDropdown'
import { TILE_PROVIDERS, TILE_PROVIDER_ORDER, type TileProvider } from '../lib/tiles'
import {
  defaultPreloadZooms,
  tileImageCache,
  type TilePreloadProgress,
} from '../lib/tileImageCache'

interface Props {
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
  imperial: boolean
  onToggleUnits: () => void
}

/**
 * Visuals menu — display options that change how the scene looks/behaves
 * (detail tile mosaic + source, full-sun lighting, auto-rotate + speed).
 * Map overlays live in the separate Layers menu.
 */
export default function VisualsMenu({
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
  imperial,
  onToggleUnits,
}: Props) {
  const activeCount = [detailTiles, fullSun, autoRotate].filter(Boolean).length
  const [preload, setPreload] = useState<TilePreloadProgress>(() =>
    tileImageCache.getProgress(),
  )

  useEffect(() => tileImageCache.subscribe(setPreload), [])

  // Background warm when detail tiles are on — follows Satellite/Street.
  useEffect(() => {
    if (!detailTiles) {
      tileImageCache.cancel()
      return
    }
    void tileImageCache.preloadAll(tileProvider, defaultPreloadZooms())
  }, [detailTiles, tileProvider])

  const pct = Math.round(preload.fraction * 100)
  const preloadLabel = preload.running
    ? `Warming ${TILE_PROVIDERS[preload.provider].label}${
        preload.zoom != null ? ` · z${preload.zoom}` : ''
      } · ${pct}%`
    : preload.complete && preload.provider === tileProvider
      ? `${TILE_PROVIDERS[tileProvider].label} ready`
      : 'Preload Earth'

  return (
    <MenuDropdown icon={Sparkles} label="Visuals" badge={activeCount} title="Visual & display options">
      {/* High-res tile mosaic — streams in when you zoom in. When on, reveal
          the Satellite/Street source switch. */}
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

            <div className="layers-preload">
              {preload.running ? (
                <button
                  type="button"
                  className="layers-preload-btn is-running"
                  onClick={() => tileImageCache.cancel()}
                  title="Cancel Earth imagery preload"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="layers-preload-label">{preloadLabel}</span>
                </button>
              ) : (
                <button
                  type="button"
                  className={`layers-preload-btn ${preload.complete && preload.provider === tileProvider ? 'is-done' : ''}`}
                  onClick={() => {
                    void tileImageCache.preloadAll(tileProvider, defaultPreloadZooms())
                  }}
                  title="Warm global Satellite/Street imagery so zoom-in stays smooth"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="layers-preload-label">{preloadLabel}</span>
                </button>
              )}
              {preload.running && (
                <div
                  className="layers-preload-bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                  aria-label="Earth tile preload progress"
                >
                  <div
                    className="layers-preload-bar-fill"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
              <p className="layers-preload-hint">
                Warms global imagery so zoom-in stays smooth
              </p>
            </div>

            {/* Esri's terms require attribution for their basemap tiles. */}
            <div className="layers-credit">© Esri</div>
          </motion.div>
        )}
      </AnimatePresence>

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

      {/* Units — metric / imperial for weather + telemetry. */}
      <div className="layers-row layers-row--static">
        <Gauge className="layers-row-icon h-4 w-4" aria-hidden="true" />
        <span className="layers-row-label">Units</span>
        <div className="layers-seg layers-seg--inline" role="group" aria-label="Units">
          <button
            type="button"
            className={`layers-seg-btn ${!imperial ? 'is-on' : ''}`}
            onClick={() => imperial && onToggleUnits()}
            aria-pressed={!imperial}
          >
            °C
          </button>
          <button
            type="button"
            className={`layers-seg-btn ${imperial ? 'is-on' : ''}`}
            onClick={() => !imperial && onToggleUnits()}
            aria-pressed={imperial}
          >
            °F
          </button>
        </div>
      </div>
    </MenuDropdown>
  )
}
