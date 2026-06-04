import { useEffect, useMemo, useState } from 'react'
import { Rocket } from 'lucide-react'
import { fetchUpcomingLaunches, type UpcomingLaunch } from '../lib/launches'

// Live countdown to the next SpaceX launch (data from Launch Library 2).
// One network fetch on mount; the clock then ticks client-side.

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function formatCountdown(ms: number): { sign: string; core: string } {
  const past = ms < 0
  let s = Math.floor(Math.abs(ms) / 1000)
  const d = Math.floor(s / 86400)
  s -= d * 86400
  const h = Math.floor(s / 3600)
  s -= h * 3600
  const m = Math.floor(s / 60)
  s -= m * 60
  const core = d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`
  return { sign: past ? 'T+' : 'T-', core }
}

export default function LaunchCountdown() {
  const [launches, setLaunches] = useState<UpcomingLaunch[]>([])
  const [nowMs, setNowMs] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchUpcomingLaunches()
      .then((l) => {
        if (!cancelled) setLaunches(l)
      })
      .catch((err) => console.warn('[LaunchCountdown] fetch failed:', err))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const tick = () => setNowMs(Date.now())
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [])

  // Prefer the soonest launch still ahead of us (allow a 1 h grace for one
  // currently lifting off); fall back to the first if the feed is stale.
  const next = useMemo(
    () => launches.find((l) => new Date(l.net).getTime() > nowMs - 3600_000) ?? launches[0],
    [launches, nowMs],
  )
  const netMs = useMemo(() => (next ? new Date(next.net).getTime() : 0), [next])

  if (!next) return null

  const { sign, core } = formatCountdown(netMs - nowMs)
  const when = Number.isFinite(netMs)
    ? new Date(netMs).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'TBD'
  const extra = launches.length - 1

  return (
    <div className="launch-card">
      <div className="launch-card-head">
        <Rocket className="h-3 w-3" aria-hidden="true" />
        <span>NEXT SPACEX LAUNCH</span>
      </div>
      <div className="launch-card-name">{next.name}</div>
      <div className="launch-card-meta">
        {next.rocket}
        {next.pad ? ` · ${next.pad}` : ''}
      </div>
      <div className="launch-card-countdown">
        <span className="lc-sign">{sign}</span>
        <span className="lc-time">{core}</span>
      </div>
      <div className="launch-card-foot">
        <span className={`lc-status lc-status--${next.status.toLowerCase()}`}>{next.status}</span>
        <span className="lc-when">{when}</span>
        {extra > 0 && <span className="lc-more">+{extra} scheduled</span>}
      </div>
    </div>
  )
}
