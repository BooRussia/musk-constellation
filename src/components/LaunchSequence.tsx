import { useEffect, useMemo, useRef, useState } from 'react'
import type { DetailedLaunch } from '../lib/launches'
import { FALCON9_SEQUENCE, offsetLabel } from '../lib/launchSequence'

// Left-side launch timeline — a big live T-minus over a vertical sequence of
// countdown + flight milestones with their nominal T-/T+ times, the way the
// Next Spaceflight app and SpaceX webcast clocks lay it out. Events fill in as
// the clock passes them. Times are the standard Falcon 9 profile (LL2's
// upcoming feed doesn't carry a per-launch timeline).

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

interface ClockParts {
  sign: string
  d: number
  h: number
  m: number
  s: number
}
function clockParts(ms: number): ClockParts {
  const past = ms < 0
  let s = Math.floor(Math.abs(ms) / 1000)
  const d = Math.floor(s / 86400)
  s -= d * 86400
  const h = Math.floor(s / 3600)
  s -= h * 3600
  const m = Math.floor(s / 60)
  s -= m * 60
  return { sign: past ? 'T+' : 'T-', d, h, m, s }
}

interface Props {
  launch: DetailedLaunch
}

export default function LaunchSequence({ launch }: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [])

  const netMs = useMemo(() => new Date(launch.net).getTime(), [launch])
  const elapsed = (nowMs - netMs) / 1000 // seconds since liftoff (neg = before)
  const parts = clockParts(netMs - nowMs)

  // The "current" event = the last one whose time has passed.
  const activeIndex = useMemo(() => {
    let idx = -1
    for (let i = 0; i < FALCON9_SEQUENCE.length; i++) {
      if (elapsed >= FALCON9_SEQUENCE[i].t) idx = i
      else break
    }
    return idx
  }, [elapsed])

  // Keep the current event in view as the clock advances.
  const activeRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  return (
    <div className="launchseq">
      <div className="launchseq-head">
        <div className="launchseq-mission">{launch.mission}</div>
        <div className="launchseq-rocket">{launch.rocket}</div>
      </div>

      <div className="launchseq-clock">
        <span className="launchseq-clock-sign">{parts.sign}</span>
        <div className="launchseq-clock-grid">
          {parts.d > 0 && (
            <div className="launchseq-clock-unit">
              <span className="launchseq-clock-val">{parts.d}</span>
              <span className="launchseq-clock-lab">DAY</span>
            </div>
          )}
          <div className="launchseq-clock-unit">
            <span className="launchseq-clock-val">{pad(parts.h)}</span>
            <span className="launchseq-clock-lab">HRS</span>
          </div>
          <div className="launchseq-clock-unit">
            <span className="launchseq-clock-val">{pad(parts.m)}</span>
            <span className="launchseq-clock-lab">MIN</span>
          </div>
          <div className="launchseq-clock-unit">
            <span className="launchseq-clock-val">{pad(parts.s)}</span>
            <span className="launchseq-clock-lab">SEC</span>
          </div>
        </div>
      </div>

      <ul className="launchseq-list">
        {FALCON9_SEQUENCE.map((e, i) => {
          const passed = i <= activeIndex
          const active = i === activeIndex
          return (
            <li
              key={`${e.label}-${e.t}`}
              ref={active ? activeRef : undefined}
              className={`launchseq-item${passed ? ' is-passed' : ''}${active ? ' is-active' : ''}`}
            >
              <span className="launchseq-bullet" />
              <span className="launchseq-evt">{e.label}</span>
              <span className="launchseq-evt-time">{offsetLabel(e.t)}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
