import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Satellite } from 'lucide-react'
import { fetchAllConstellations, type ConstellationKey, type SatelliteEntry } from '../lib/tle'

const EarthScene = lazy(() => import('./EarthScene'))

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
 *   • CelesTrak TLE fetch on mount (Starlink + OneWeb)
 *   • SGP4 propagation per frame → glow points at correct altitudes
 *   • Sidebar with live count + per-constellation filter toggles
 *   • Phase 3 will add the historical timeline scrubber
 */
export default function StarlinkView({ onBack }: Props) {
  const [satellites, setSatellites] = useState<SatelliteEntry[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'partial' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [enabledConstellations, setEnabledConstellations] = useState<Set<ConstellationKey>>(
    new Set(['starlink', 'oneweb']),
  )

  // Fetch TLEs on mount. Stays alive in sessionStorage for 2 hours
  // so a tab reload doesn't refetch.
  useEffect(() => {
    let cancelled = false
    fetchAllConstellations()
      .then(({ satellites, errors }) => {
        if (cancelled) return
        setSatellites(satellites)
        if (satellites.length === 0) {
          setLoadState('error')
          setErrorMsg(
            errors[0]?.error instanceof Error
              ? errors[0].error.message
              : 'TLE feeds returned no data',
          )
        } else if (errors.length > 0) {
          setLoadState('partial')
          setErrorMsg(`${errors.length} of ${errors.length + 1} feeds failed`)
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

  // Per-constellation counts for the sidebar.
  const counts = useMemo(() => {
    const c: Record<ConstellationKey, number> = { starlink: 0, oneweb: 0 }
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
          <span className="starlink-eyebrow">STARLINK · LIVE</span>
          <h1 className="starlink-title">Orbital Constellation</h1>
        </div>

        <div className="starlink-status">
          <Satellite className="h-3 w-3" aria-hidden="true" />
          <span className="starlink-status-count">
            {visibleCount > 0 ? visibleCount.toLocaleString() : '—'}
          </span>
          <span className="starlink-status-label">tracked</span>
        </div>
      </header>

      <div className="starlink-canvas">
        <EarthErrorBoundary onBack={onBack}>
          <Suspense fallback={<StarlinkLoading />}>
            <EarthScene
              satellites={satellites}
              enabledConstellations={enabledConstellations}
            />
          </Suspense>
        </EarthErrorBoundary>
      </div>

      {/* Sidebar — constellation filters + live counts */}
      <aside className="starlink-sidebar glass panel">
        <header className="starlink-sidebar-header">
          <span className="starlink-sidebar-eyebrow">CONSTELLATIONS</span>
        </header>

        <ul className="starlink-sidebar-list">
          <ConstellationRow
            label="Starlink"
            sublabel="SpaceX broadband mesh"
            count={counts.starlink}
            color="#e8f1ff"
            active={enabledConstellations.has('starlink')}
            onToggle={() => toggleConstellation('starlink')}
          />
          <ConstellationRow
            label="OneWeb"
            sublabel="LEO comms · Eutelsat"
            count={counts.oneweb}
            color="#ffc94a"
            active={enabledConstellations.has('oneweb')}
            onToggle={() => toggleConstellation('oneweb')}
          />
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
