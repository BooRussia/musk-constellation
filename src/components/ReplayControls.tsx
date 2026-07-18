import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Crosshair, Move3d, Pause, Play, X } from 'lucide-react'
import type { ReplayControl } from './LaunchReplay'
import type { PastLaunch } from '../lib/pastLaunches'
import {
  eventsForReplay,
  stageMetaForLabel,
  type StageAction,
} from '../lib/launchSequence'

const SPEEDS = [1, 8, 60]
/** Speeds YouTube can actually mirror while the webcast is synced. */
const SYNC_SPEEDS = [1, 2]

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
  /** When true, speed options are capped to what YouTube can mirror. */
  syncActive?: boolean
  /** Snap camera to a side view of the lofted trajectory. */
  onSideView?: () => void
  /** Re-fly the chase-cam onto the rocket. */
  onRecenter?: () => void
}

/** Bottom transport bar for the launch replay. Reads the shared control ref
 *  ~5×/s for the clock/scrubber/event so the per-frame animation never
 *  re-renders React; writes back play/speed/seek. Stage callouts fire when
 *  the active milestone advances. */
export default function ReplayControls({
  launch,
  ctrlRef,
  onClose,
  syncActive,
  onSideView,
  onRecenter,
}: Props) {
  const [snap, setSnap] = useState({
    t: 0,
    duration: 0,
    currentEvent: null as string | null,
    currentAction: null as StageAction | null,
    altKm: 0,
    downrangeKm: 0,
  })
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(8)
  const [calloutKey, setCalloutKey] = useState(0)
  const prevEventRef = useRef<string | null>(null)
  const speeds = syncActive ? SYNC_SPEEDS : SPEEDS

  // Drop to 1× when the synced webcast opens — YouTube can't do 8×/60×.
  useEffect(() => {
    if (!syncActive) return
    if (ctrlRef.current.speed > 2) {
      ctrlRef.current.speed = 1
      setSpeed(1)
    }
  }, [syncActive, ctrlRef])

  useEffect(() => {
    const sample = () => {
      const c = ctrlRef.current
      setSnap({
        t: c.t,
        duration: c.duration,
        currentEvent: c.currentEvent,
        currentAction: c.currentAction,
        altKm: c.altKm,
        downrangeKm: c.downrangeKm,
      })
      setPlaying(c.playing)
      setSpeed(c.speed)
      if (c.currentEvent && c.currentEvent !== prevEventRef.current) {
        prevEventRef.current = c.currentEvent
        setCalloutKey((k) => k + 1)
      } else if (!c.currentEvent) {
        prevEventRef.current = null
      }
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
  const events = eventsForReplay(launch.events).filter((e) => e.t >= 0 && e.t <= dur)
  const meta = snap.currentEvent ? stageMetaForLabel(snap.currentEvent) : null
  const accent = meta?.color ?? '#ff9a4a'

  return (
    <div className="replaybar-stack">
      {snap.currentEvent && meta && (
        <div
          key={calloutKey}
          className={`replay-stage-callout replay-stage-callout--${meta.action}`}
          style={{ '--stage-accent': accent } as CSSProperties}
          role="status"
          aria-live="polite"
        >
          <span className="replay-stage-callout-verb">{meta.verb}</span>
          <span className="replay-stage-callout-label">{snap.currentEvent}</span>
          <span className="replay-stage-callout-chapter">{meta.chapter}</span>
        </div>
      )}

      <div
        className={`replaybar${meta ? ` replaybar--${meta.action}` : ''}`}
        style={meta ? ({ '--stage-accent': accent } as CSSProperties) : undefined}
      >
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
          <span className="replaybar-tele" title="Modeled typical Falcon 9 profile — not raw telemetry">
            <span className="replaybar-tele-item">
              <span className="replaybar-tele-k">Alt</span>
              <span className="replaybar-tele-v">
                {snap.altKm < 10 ? snap.altKm.toFixed(1) : Math.round(snap.altKm)} km
              </span>
            </span>
            <span className="replaybar-tele-item">
              <span className="replaybar-tele-k">Range</span>
              <span className="replaybar-tele-v">{Math.round(snap.downrangeKm).toLocaleString()} km</span>
            </span>
          </span>
          {meta && (
            <span className="replaybar-event">
              <span className="replaybar-event-verb">{meta.verb}</span>
              {snap.currentEvent}
            </span>
          )}
        </div>

        <div className="replaybar-scrubwrap">
          <div className="replaybar-ticks" aria-hidden="true">
            {events.map((e, i) => {
              const tickMeta = stageMetaForLabel(e.label)
              return (
                <span
                  key={`${e.t}-${i}`}
                  className={`replaybar-tick ${e.t <= t ? 'is-passed' : ''}`}
                  style={{
                    left: `${(e.t / dur) * 100}%`,
                    '--tick-accent': tickMeta.color,
                  } as CSSProperties}
                  title={`${tickMeta.verb} · ${e.label} · ${fmtT(e.t)}`}
                />
              )
            })}
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
        </div>

        <div className="replaybar-speeds">
          {speeds.map((s) => (
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

        {(onSideView || onRecenter) && (
          <div className="replaybar-cam" role="group" aria-label="Camera">
            {onSideView && (
              <button
                type="button"
                className="replaybar-cam-btn"
                onClick={onSideView}
                title="View the lofted trajectory from the side"
              >
                <Move3d className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Side</span>
              </button>
            )}
            {onRecenter && (
              <button
                type="button"
                className="replaybar-cam-btn"
                onClick={onRecenter}
                title="Reset chase camera onto the rocket"
              >
                <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Recenter</span>
              </button>
            )}
          </div>
        )}

        <button type="button" className="replaybar-close" onClick={onClose} aria-label="Close replay">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
