import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ChevronDown, Satellite, X } from 'lucide-react'
import {
  fetchAllConstellations,
  fetchISS,
  CONSTELLATIONS,
  DEFAULT_ENABLED_CONSTELLATIONS,
  type ConstellationKey,
  type SatelliteEntry,
  type TrackedObject,
} from '../lib/tle'
import ISSInfoCard from './ISSInfoCard'
import type { ISSTelemetry } from './ISSTracker'
import LaunchCountdown from './LaunchCountdown'
import type { SatelliteHit } from './SatelliteCloud'
import {
  setHighlightedNoradIds,
  useSatelliteHover,
  useSatelliteSelect,
} from './SatelliteInteractionContext'
import SatelliteTooltip from './SatelliteTooltip'
import { trailColorAt } from '../lib/trailColors'
import { PHOTOREAL_STYLE } from '../data/mapStyles'
import type { TileProvider } from '../lib/tiles'
import MapStylePicker from './MapStylePicker'
import LayersMenu from './LayersMenu'
import VisualsMenu from './VisualsMenu'

const EarthScene = lazy(() => import('./EarthScene'))

// Default the constellation legend open on desktop, collapsed on phones
// (where it would otherwise cover most of the screen). Read once at module
// load so it's not a render-time side effect.
const LEGEND_DEFAULT_OPEN =
  typeof window === 'undefined' ? true : window.innerWidth > 639

// Auto-rotation speed presets (label → OrbitControls autoRotateSpeed).
const ROTATE_SPEEDS = [
  { label: '0.5×', value: 1 },
  { label: '1×', value: 2 },
  { label: '2×', value: 4 },
  { label: '4×', value: 8 },
]

/** Earth scene errors fall back here instead of black-screening. */
class EarthErrorBoundary extends React.Component<
  { children: React.ReactNode; onBack: () => void },
  { hasError: boolean; error?: Error }
> {
  state = { hasError: false, error: undefined as Error | undefined }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Earth scene failed:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="starlink-loading">
          <div className="starlink-loading-orb" style={{ animation: 'none', opacity: 0.4 }} />
          <p>Earth scene failed to load</p>
          <p style={{ fontSize: 10, opacity: 0.6, maxWidth: 280, textAlign: 'center' }}>
            {this.state.error?.message ?? 'Unknown error'}
          </p>
          <button
            type="button"
            onClick={this.props.onBack}
            className="starlink-back"
            style={{ marginTop: 12 }}
          >
            Back to constellation
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

interface Props {
  onBack: () => void
}

/**
 * Starlink constellation view — Phase 2: live TLE tracking.
 *
 *   • Earth scene with real-time terminator (sun direction from UTC)
 *   • CelesTrak TLE fetch on mount for every constellation in
 *     CONSTELLATIONS (Starlink, Kuiper, OneWeb, Iridium, Globalstar,
 *     Orbcomm + the MEO/GEO operators SES, Intelsat, Telesat)
 *   • SGP4 propagation per frame → glow points at correct altitudes
 *   • Sidebar with live count + per-constellation filter toggles
 *   • Phase 3 will add the historical timeline scrubber
 */
export default function StarlinkView({ onBack }: Props) {
  const [satellites, setSatellites] = useState<SatelliteEntry[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'partial' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [enabledConstellations, setEnabledConstellations] = useState<Set<ConstellationKey>>(
    () => new Set(DEFAULT_ENABLED_CONSTELLATIONS),
  )
  // Selected map style (planet skin). Swaps the day/albedo texture on the
  // photoreal globe — see src/data/mapStyles.ts (auto-discovers any image
  // dropped into src/assets/map-styles/).
  const [mapStyleId, setMapStyleId] = useState<string>(PHOTOREAL_STYLE.id)
  // Day/night cycle. Off = full sun: the whole planet is evenly lit with
  // no cast terminator shadow.
  const [dayCycle, setDayCycle] = useState(true)
  // Constellation legend collapse (mainly for mobile, where it covers the
  // globe). Collapsed shows just the tappable header bar.
  const [legendOpen, setLegendOpen] = useState(LEGEND_DEFAULT_OPEN)
  // Auto-rotation of the globe + which speed preset is active (on by default).
  const [autoRotate, setAutoRotate] = useState(true)
  const [rotateSpeedIdx, setRotateSpeedIdx] = useState(0) // 0.5× default
  // Country + US-state border overlay (works on any map; on by default).
  const [borders, setBorders] = useState(true)
  // Lon/lat graticule overlay (works on any map).
  const [graticule, setGraticule] = useState(false)
  // Worldwide rocket launch-site markers (on by default).
  const [launchSites, setLaunchSites] = useState(true)
  // Place-name labels (continents / oceans / cities; on by default).
  const [labels, setLabels] = useState(true)
  // Google-Maps-style high-res tile mosaic (streams in when you zoom in).
  const [detailTiles, setDetailTiles] = useState(true)
  const [tileProvider, setTileProvider] = useState<TileProvider>('satellite')
  // Live ISS tracking (on by default). Position from its TLE; the shared
  // ref carries per-frame altitude/speed to the info card without re-render.
  const [iss, setIss] = useState(true)
  const [issSat, setIssSat] = useState<TrackedObject | null>(null)
  const issTelemetryRef = useRef<ISSTelemetry>({ altKm: 0, speedKms: 0, hasFix: false })

  // Fetch TLEs on mount. Stays alive in sessionStorage for 2 hours
  // so a tab reload doesn't refetch.
  useEffect(() => {
    let cancelled = false
    fetchAllConstellations()
      .then(({ satellites, errors }) => {
        if (cancelled) return
        setSatellites(satellites)
        // Verbose errors in console for debugging, concise UI string.
        if (errors.length > 0) {
          for (const e of errors) console.warn(`[StarlinkView] ${e.group} failed:`, e.error)
        }
        if (satellites.length === 0) {
          setLoadState('error')
          const first = errors[0]?.error
          const msg = first instanceof Error
            ? first.message
            : typeof first === 'string'
              ? first
              : 'CelesTrak returned no data'
          setErrorMsg(msg)
        } else if (errors.length > 0) {
          setLoadState('partial')
          const failed = errors.map(e => e.group).join(', ')
          setErrorMsg(`${failed} unavailable`)
        } else {
          setLoadState('ready')
        }
      })
      .catch((err) => {
        if (cancelled) return
        setLoadState('error')
        setErrorMsg(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Fetch the ISS TLE separately (single object, its own cache). Failure
  // here is non-fatal — the rest of the sky still loads.
  useEffect(() => {
    let cancelled = false
    fetchISS()
      .then((sat) => {
        if (!cancelled && sat) setIssSat(sat)
      })
      .catch((err) => console.warn('[StarlinkView] ISS fetch failed:', err))
    return () => {
      cancelled = true
    }
  }, [])

  // Per-constellation counts for the sidebar. Seed every key at 0 so a
  // constellation that failed to load still shows a row (with "—").
  const counts = useMemo(() => {
    const c = Object.fromEntries(
      CONSTELLATIONS.map((m) => [m.key, 0]),
    ) as Record<ConstellationKey, number>
    for (const sat of satellites) c[sat.constellation]++
    return c
  }, [satellites])

  // Visible count = sum of enabled constellations.
  const visibleCount = useMemo(() => {
    let n = 0
    for (const key of enabledConstellations) n += counts[key]
    return n
  }, [counts, enabledConstellations])

  function toggleConstellation(key: ConstellationKey) {
    setEnabledConstellations((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      // Don't let user disable everything — leaves an empty scene.
      if (next.size === 0) return prev
      return next
    })
  }

  // ============================================
  // Hover + pinned-card interaction state.
  // ============================================
  // SatelliteCloud emits hover/select events via the module-level
  // pub/sub (see SatelliteInteractionContext.tsx for why). We just
  // listen here and translate them into UI state for the tooltip
  // and the pinned card.
  const [hoveredSat, setHoveredSat] = useState<SatelliteHit | null>(null)
  // Multi-select: clicking a sat toggles it into this list (in click
  // order, which also drives its trail color). Each selected sat gets
  // an orbit trail; the panel lists them so you can compare paths.
  const [selectedSats, setSelectedSats] = useState<SatelliteHit[]>([])

  const handleHover = useCallback((hit: SatelliteHit | null) => {
    setHoveredSat(hit)
  }, [])

  const handleSelect = useCallback((hit: SatelliteHit | null) => {
    if (hit === null) {
      // Click on empty space clears the whole selection.
      setSelectedSats([])
      return
    }
    setSelectedSats((prev) => {
      const idx = prev.findIndex((s) => s.entry.noradId === hit.entry.noradId)
      if (idx !== -1) {
        // Already selected → toggle it off.
        return prev.filter((_, i) => i !== idx)
      }
      return [...prev, hit]
    })
  }, [])

  useSatelliteHover(handleHover)
  useSatelliteSelect(handleSelect)

  // Publish the set of sats to enlarge in the cloud — all selected
  // sats plus the currently-hovered one.
  const highlightedIds = useMemo(() => {
    const s = new Set<number>(selectedSats.map((x) => x.entry.noradId))
    if (hoveredSat) s.add(hoveredSat.entry.noradId)
    return s
  }, [selectedSats, hoveredSat])
  useEffect(() => {
    setHighlightedNoradIds(highlightedIds)
    return () => setHighlightedNoradIds(new Set())
  }, [highlightedIds])

  // Entries (selection order) for the orbit trails.
  const selectedEntries = useMemo(
    () => selectedSats.map((s) => s.entry),
    [selectedSats],
  )

  const removeSelected = useCallback((noradId: number) => {
    setSelectedSats((prev) => prev.filter((s) => s.entry.noradId !== noradId))
  }, [])
  const clearSelected = useCallback(() => setSelectedSats([]), [])

  // Suppress the cursor tooltip when hovering an already-selected sat —
  // its info is already pinned in the selection panel.
  const suppressTooltip =
    hoveredSat !== null && selectedSats.some((s) => s.entry.noradId === hoveredSat.entry.noradId)

  return (
    <div className="starlink-view">
      <header className="starlink-topnav">
        <button
          type="button"
          onClick={onBack}
          className="starlink-back"
          aria-label="Back to constellation"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Constellation</span>
        </button>

        <div className="starlink-brand">
          <span className="starlink-eyebrow">LIVE · ORBITAL NETWORK</span>
          <h1 className="starlink-title">Orbital Constellation</h1>
        </div>

        <div className="starlink-topright">
          {/* Map-style picker — drops a column of thumbnail previews down
              the right side. Picks the globe skin, including the dark
              procedural "Dark Map". */}
          <MapStylePicker value={mapStyleId} onChange={setMapStyleId} />

          {/* Layers menu — map overlays that sit on the globe surface. */}
          <LayersMenu
            borders={borders}
            onBorders={() => setBorders((b) => !b)}
            graticule={graticule}
            onGraticule={() => setGraticule((g) => !g)}
            launchSites={launchSites}
            onLaunchSites={() => setLaunchSites((s) => !s)}
            labels={labels}
            onLabels={() => setLabels((l) => !l)}
            iss={iss}
            onIss={() => setIss((v) => !v)}
          />

          {/* Visuals menu — display options (detail tiles, lighting, motion). */}
          <VisualsMenu
            detailTiles={detailTiles}
            onDetailTiles={() => setDetailTiles((t) => !t)}
            tileProvider={tileProvider}
            onTileProvider={setTileProvider}
            fullSun={!dayCycle}
            onFullSun={() => setDayCycle((d) => !d)}
            autoRotate={autoRotate}
            onAutoRotate={() => setAutoRotate((r) => !r)}
            speedLabel={ROTATE_SPEEDS[rotateSpeedIdx].label}
            onCycleSpeed={() => setRotateSpeedIdx((i) => (i + 1) % ROTATE_SPEEDS.length)}
          />
          <div className="starlink-status">
            <Satellite className="h-3 w-3" aria-hidden="true" />
            <span className="starlink-status-count">
              {visibleCount > 0 ? visibleCount.toLocaleString() : '—'}
            </span>
            <span className="starlink-status-label">tracked</span>
          </div>
        </div>
      </header>

      <div className="starlink-canvas">
        <EarthErrorBoundary onBack={onBack}>
          <Suspense fallback={<StarlinkLoading />}>
            <EarthScene
              satellites={satellites}
              enabledConstellations={enabledConstellations}
              selectedSatellites={selectedEntries}
              mapStyleId={mapStyleId}
              dayCycle={dayCycle}
              autoRotate={autoRotate}
              autoRotateSpeed={ROTATE_SPEEDS[rotateSpeedIdx].value}
              borders={borders}
              graticule={graticule}
              launchSites={launchSites}
              labels={labels}
              iss={iss}
              issSat={issSat}
              issTelemetryRef={issTelemetryRef}
              detailTiles={detailTiles}
              tileProvider={tileProvider}
            />
          </Suspense>
        </EarthErrorBoundary>

        {/* Live ISS readout — altitude/speed + docked Crew Dragon. */}
        {iss && issSat && <ISSInfoCard telemetryRef={issTelemetryRef} />}

        {/* Next SpaceX launch — live countdown (Launch Library 2). */}
        <LaunchCountdown />

        {/* Hover tooltip — follows cursor, fades in/out. Renders in
            the canvas wrapper (not document body) so it's clipped
            with the scene if the layout ever changes. */}
        <AnimatePresence>
          {hoveredSat && !suppressTooltip && (
            <SatelliteTooltip key="tooltip" hit={hoveredSat} />
          )}
        </AnimatePresence>

        {/* Selection panel — top-right, lists every selected sat with
            its trail color, key orbital stats, and a remove button.
            Click sats to add/remove; click empty space to clear all.
            Each row's swatch matches that sat's orbit-trail color. */}
        <AnimatePresence>
          {selectedSats.length > 0 && (
            <motion.aside
              key="selection-panel"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              className="sat-selection glass panel"
              aria-label="Selected satellites"
            >
              <header className="sat-selection-header">
                <span className="sat-selection-title">
                  SELECTED · {selectedSats.length}
                </span>
                <button
                  type="button"
                  className="sat-selection-clear"
                  onClick={clearSelected}
                >
                  Clear all
                </button>
              </header>
              <ul className="sat-selection-list">
                {selectedSats.map((s, i) => (
                  <li key={s.entry.noradId} className="sat-selection-row">
                    <span
                      className="sat-selection-swatch"
                      style={{ background: trailColorAt(i), boxShadow: `0 0 6px ${trailColorAt(i)}` }}
                    />
                    <span className="sat-selection-info">
                      <span className="sat-selection-name">{s.entry.name}</span>
                      <span className="sat-selection-meta">
                        {Math.round(s.altitudeKm).toLocaleString()} km ·{' '}
                        {s.velocityKmS.toFixed(2)} km/s · {s.periodMin.toFixed(0)} min
                      </span>
                    </span>
                    <button
                      type="button"
                      className="sat-selection-remove"
                      onClick={() => removeSelected(s.entry.noradId)}
                      aria-label={`Remove ${s.entry.name}`}
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
              <p className="sat-selection-hint">
                Click more sats to compare paths · click space to clear
              </p>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Keyboard camera hints — desktop only, bottom-center so it
            clears the bottom-left sidebar and the top-right pinned card.
            Mirrors the constellation view's hints chrome. */}
        <div className="starlink-kbd-hints">
          W/S — up/down &nbsp;•&nbsp; A/D — orbit &nbsp;•&nbsp; Q/E — zoom &nbsp;•&nbsp; Arrows — pan
        </div>
      </div>

      {/* Sidebar — constellation filters + live counts. Collapsible
          (tap the header) so it doesn't cover the globe on phones. */}
      <aside
        className={`starlink-sidebar glass panel ${legendOpen ? '' : 'starlink-sidebar--collapsed'}`}
      >
        <button
          type="button"
          className="starlink-sidebar-header"
          onClick={() => setLegendOpen((o) => !o)}
          aria-expanded={legendOpen}
          aria-label={legendOpen ? 'Collapse constellation legend' : 'Expand constellation legend'}
        >
          <span className="starlink-sidebar-eyebrow">CONSTELLATIONS</span>
          <ChevronDown
            className={`starlink-sidebar-chevron h-4 w-4 ${legendOpen ? 'is-open' : ''}`}
            aria-hidden="true"
          />
        </button>

        <motion.div
          className="starlink-sidebar-body"
          initial={false}
          animate={{ height: legendOpen ? 'auto' : 0, opacity: legendOpen ? 1 : 0 }}
          transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
          style={{ overflow: 'hidden' }}
        >
          <ul className="starlink-sidebar-list">
            {CONSTELLATIONS.map((m) => (
              <ConstellationRow
                key={m.key}
                label={m.label}
                sublabel={m.sublabel}
                count={counts[m.key]}
                color={m.color}
                active={enabledConstellations.has(m.key)}
                onToggle={() => toggleConstellation(m.key)}
              />
            ))}
          </ul>

          <footer className="starlink-sidebar-footer">
            <p className="starlink-sidebar-status">
              {loadState === 'loading' && 'Pulling fresh TLE data from CelesTrak…'}
              {loadState === 'ready' && `Tracking ${satellites.length.toLocaleString()} sats live`}
              {loadState === 'partial' && `${satellites.length.toLocaleString()} sats live · ${errorMsg}`}
              {loadState === 'error' && (errorMsg || 'No TLE data available')}
            </p>
            <p className="starlink-sidebar-source">
              Source: <a href="https://celestrak.org" target="_blank" rel="noopener noreferrer">CelesTrak</a> · SGP4 propagation · Refresh every 2h
            </p>
          </footer>
        </motion.div>
      </aside>
    </div>
  )
}

function ConstellationRow({
  label,
  sublabel,
  count,
  color,
  active,
  onToggle,
}: {
  label: string
  sublabel: string
  count: number
  color: string
  active: boolean
  onToggle: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={`starlink-row ${active ? 'starlink-row--on' : ''}`}
        aria-pressed={active}
      >
        <span className="starlink-row-dot" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
        <span className="starlink-row-text">
          <span className="starlink-row-label">{label}</span>
          <span className="starlink-row-sublabel">{sublabel}</span>
        </span>
        <span className="starlink-row-count">{count > 0 ? count.toLocaleString() : '—'}</span>
      </button>
    </li>
  )
}

function StarlinkLoading() {
  return (
    <div className="starlink-loading">
      <div className="starlink-loading-orb" />
      <p>Loading Earth…</p>
    </div>
  )
}
