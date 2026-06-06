import { useEffect, useState } from 'react'
import { Pause, Play, X } from 'lucide-react'
import type { ReplayControl } from './LaunchReplay'
import type { PastLaunch } from '../lib/pastLaunches'

const SPEEDS = [1, 8, 60]

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function fmtT(t: number): string {
  const s = Math.max(0, Math.floor(t))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `T+ ${h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`}`
}

interface Props {
  launch: PastLaunch
  ctrlRef: React.MutableRefObject<ReplayControl>
  onClose: () => void
}

/** Bottom transport bar for the launch replay. Reads the shared control ref
 *  ~5×/s for the clock/scrubber/event so the per-frame animation never
 *  re-renders React; writes back play/speed/seek. */
export default function ReplayControls({ launch, ctrlRef, onClose }: Props) {
  // Snapshot the control ref ~5×/s into state so render never reads the ref.
  const [snap, setSnap] = useState({ t: 0, duration: 0, currentEvent: null as string | null })
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(8)

  useEffect(() => {
    const sample = () => {
      const c = ctrlRef.current
      setSnap({ t: c.t, duration: c.duration, currentEvent: c.currentEvent })
      setPlaying(c.playing)
      setSpeed(c.speed)
    }
    sample()
    const id = window.setInterval(sample, 200)
    return () => window.clearInterval(id)
  }, [ctrlRef])

  const dur = snap.duration || 1
  const t = Math.min(snap.t, dur)
  const date = new Date(launch.net).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  return (
    <div className="replaybar">
      <div className="replaybar-id">
        <div className="replaybar-mission">{launch.mission}</div>
        <div className="replaybar-sub">
          {date} · {launch.pad.name}
          {launch.hasRealTimeline ? '' : ' · modeled timeline'}
        </div>
      </div>

      <button
        type="button"
        className="replaybar-play"
        onClick={() => {
          const next = !ctrlRef.current.playing
          ctrlRef.current.playing = next
          setPlaying(next)
        }}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>

      <div className="replaybar-clock">
        <span className="replaybar-time">{fmtT(t)}</span>
        {snap.currentEvent && <span className="replaybar-event">{snap.currentEvent}</span>}
      </div>

      <input
        className="replaybar-scrub"
        type="range"
        min={0}
        max={Math.round(dur)}
        step={1}
        value={Math.round(t)}
        onChange={(e) => {
          ctrlRef.current.seekTo = Number(e.target.value)
        }}
        aria-label="Scrub launch timeline"
      />

      <div className="replaybar-speeds">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            className={`replaybar-speed ${speed === s ? 'is-on' : ''}`}
            onClick={() => {
              ctrlRef.current.speed = s
              setSpeed(s)
            }}
          >
            {s}×
          </button>
        ))}
      </div>

      <button type="button" className="replaybar-close" onClick={onClose} aria-label="Close replay">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
