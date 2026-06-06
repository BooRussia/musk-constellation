import { useEffect } from 'react'
import { Rocket, X } from 'lucide-react'
import type { PastLaunch } from '../lib/pastLaunches'

interface Props {
  launches: PastLaunch[]
  onSelect: (l: PastLaunch) => void
  onClose: () => void
}

/** Centered list of past launches to replay. */
export default function ReplayPicker({ launches, onSelect, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="replaypicker-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="replaypicker">
        <div className="replaypicker-head">
          <span className="replaypicker-title">
            <Rocket className="h-3.5 w-3.5" aria-hidden="true" /> Replay a past launch
          </span>
          <button className="replaypicker-close" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        {launches.length === 0 ? (
          <div className="replaypicker-empty">Loading launches…</div>
        ) : (
          <ul className="replaypicker-list">
            {launches.map((l) => (
              <li key={l.id}>
                <button type="button" className="replaypicker-item" onClick={() => onSelect(l)}>
                  <span className="replaypicker-mission">{l.mission}</span>
                  <span className="replaypicker-meta">
                    {new Date(l.net).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}{' '}
                    · {l.orbit} · {l.pad.location || l.pad.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
