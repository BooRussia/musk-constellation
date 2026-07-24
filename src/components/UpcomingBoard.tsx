import { useEffect, useState } from 'react'
import { CalendarDays, X } from 'lucide-react'
import { fetchUpcomingLaunches, type UpcomingLaunch } from '../lib/launches'

// Upcoming SpaceX flight board — next few launches from LL2. Click a row
// to spin the globe to that pad and arm the live launch tracker.

function fmtNet(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

interface Props {
  open: boolean
  onClose: () => void
  onSelect: (launch: UpcomingLaunch) => void
  /** Highlight the currently tracked next-launch id when known. */
  activeId?: string | null
}

export default function UpcomingBoard({ open, onClose, onSelect, activeId }: Props) {
  const [launches, setLaunches] = useState<UpcomingLaunch[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchUpcomingLaunches()
      .then((list) => {
        if (cancelled) return
        setLaunches(list)
        if (list.length === 0) setError('No upcoming launches available right now.')
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the upcoming board.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) return null

  return (
    <div className="upcoming-overlay" role="dialog" aria-label="Upcoming SpaceX launches">
      <div className="upcoming-board">
        <div className="upcoming-head">
          <span className="upcoming-title">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            Upcoming flights
          </span>
          <button type="button" className="upcoming-close" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="upcoming-hint">Select a flight to focus its pad and arm the tracker.</p>
        {loading && <div className="upcoming-empty">Loading…</div>}
        {!loading && error && <div className="upcoming-empty">{error}</div>}
        {!loading && !error && (
          <ul className="upcoming-list">
            {launches.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  className={`upcoming-item${activeId === l.id ? ' is-active' : ''}`}
                  onClick={() => onSelect(l)}
                >
                  <div className="upcoming-item-top">
                    <span className="upcoming-mission">{l.name}</span>
                    <span className="upcoming-status">{l.status}</span>
                  </div>
                  <div className="upcoming-meta">
                    <span>{fmtNet(l.net)}</span>
                    <span>{l.rocket}</span>
                    {l.orbit && <span>{l.orbit}</span>}
                  </div>
                  <div className="upcoming-pad">{l.pad || 'Pad TBD'}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
