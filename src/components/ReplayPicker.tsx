import { useEffect, useMemo, useState } from 'react'
import { Rocket, X } from 'lucide-react'
import type { PastLaunch } from '../lib/pastLaunches'

interface Props {
  launches: PastLaunch[]
  onSelect: (l: PastLaunch) => void
  onClose: () => void
}

/** Group a specific rocket variant into a ship family for filtering. */
function shipFamily(rocket: string): string {
  if (/falcon\s*heavy/i.test(rocket)) return 'Falcon Heavy'
  if (/falcon\s*9/i.test(rocket)) return 'Falcon 9'
  if (/starship|super\s*heavy/i.test(rocket)) return 'Starship'
  if (/dragon/i.test(rocket)) return 'Dragon'
  return rocket
}

const ALL = 'All'

function fmtDate(net: string): string {
  return new Date(net).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** Centered list of past launches to replay, filterable + grouped by ship. */
export default function ReplayPicker({ launches, onSelect, onClose }: Props) {
  const [filter, setFilter] = useState<string>(ALL)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Ship families present, ordered by how many launches each flew.
  const families = useMemo(() => {
    const counts = new Map<string, number>()
    for (const l of launches) {
      const f = shipFamily(l.rocket)
      counts.set(f, (counts.get(f) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [launches])

  // The visible launches grouped by ship family. When a family is selected we
  // show just that one; otherwise every family in order.
  const groups = useMemo(() => {
    const wanted = filter === ALL ? families.map((f) => f.name) : [filter]
    return wanted
      .map((name) => ({
        name,
        items: launches.filter((l) => shipFamily(l.rocket) === name),
      }))
      .filter((g) => g.items.length > 0)
  }, [filter, families, launches])

  const renderItem = (l: PastLaunch) => (
    <li key={l.id}>
      <button type="button" className="replaypicker-item" onClick={() => onSelect(l)}>
        <span className="replaypicker-item-top">
          <span className="replaypicker-mission">{l.mission}</span>
          <span className="replaypicker-ship">{shipFamily(l.rocket)}</span>
        </span>
        <span className="replaypicker-meta">
          {fmtDate(l.net)} · {l.orbit} · {l.pad.location || l.pad.name}
        </span>
      </button>
    </li>
  )

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

        {launches.length > 0 && (
          <div className="replaypicker-filters" role="group" aria-label="Filter by ship">
            <button
              type="button"
              className={`replaypicker-chip ${filter === ALL ? 'is-on' : ''}`}
              onClick={() => setFilter(ALL)}
              aria-pressed={filter === ALL}
            >
              All <span className="replaypicker-chip-count">{launches.length}</span>
            </button>
            {families.map((f) => (
              <button
                key={f.name}
                type="button"
                className={`replaypicker-chip ${filter === f.name ? 'is-on' : ''}`}
                onClick={() => setFilter(f.name)}
                aria-pressed={filter === f.name}
              >
                {f.name} <span className="replaypicker-chip-count">{f.count}</span>
              </button>
            ))}
          </div>
        )}

        {launches.length === 0 ? (
          <div className="replaypicker-empty">Loading launches…</div>
        ) : (
          <div className="replaypicker-scroll">
            {groups.map((g) => (
              <div className="replaypicker-group" key={g.name}>
                {filter === ALL && (
                  <div className="replaypicker-grouphead">
                    {g.name} <span className="replaypicker-grouphead-count">{g.items.length}</span>
                  </div>
                )}
                <ul className="replaypicker-list">{g.items.map(renderItem)}</ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
