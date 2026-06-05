import { useEffect, useState } from 'react'
import { Rocket } from 'lucide-react'
import type { DetailedLaunch } from '../lib/launches'

// Compact next-launch countdown chip for the top bar. Clicking it spins the
// globe to the launch pad and opens the launch tracker.

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function countdown(ms: number): string {
  const past = ms < 0
  let s = Math.floor(Math.abs(ms) / 1000)
  const d = Math.floor(s / 86400)
  s -= d * 86400
  const h = Math.floor(s / 3600)
  s -= h * 3600
  const m = Math.floor(s / 60)
  s -= m * 60
  const core = d > 0 ? `${d}d ${pad(h)}:${pad(m)}` : `${pad(h)}:${pad(m)}:${pad(s)}`
  return `${past ? 'T+' : 'T-'} ${core}`
}

interface Props {
  launch: DetailedLaunch | null
  active: boolean
  onClick: () => void
}

export default function LaunchPill({ launch, active, onClick }: Props) {
  const [nowMs, setNowMs] = useState(0)
  useEffect(() => {
    const tick = () => setNowMs(Date.now())
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [])

  if (!launch) return null
  const cd = countdown(new Date(launch.net).getTime() - nowMs)

  return (
    <button
      type="button"
      className={`launchpill ${active ? 'launchpill--on' : ''}`}
      onClick={onClick}
      title={`Next SpaceX launch — spin the globe to the pad (${launch.mission})`}
    >
      <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="launchpill-cd">{cd}</span>
    </button>
  )
}
