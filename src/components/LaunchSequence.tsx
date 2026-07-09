import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { DetailedLaunch } from '../lib/launches'
import {
  FALCON9_SEQUENCE,
  offsetLabel,
  stageMetaForEvent,
  type SeqPhase,
} from '../lib/launchSequence'

// Left-side launch timeline — big live T-minus over a vertical sequence of
// countdown + flight milestones. Stages are grouped into chapters and the
// active event fires a pronounced callout with a defined stage action.

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
  const [calloutKey, setCalloutKey] = useState(0)
  const prevActiveRef = useRef(-1)

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [])

  const netMs = useMemo(() => new Date(launch.net).getTime(), [launch])
  const elapsed = (nowMs - netMs) / 1000
  const parts = clockParts(netMs - nowMs)
  const phase: SeqPhase = elapsed >= 0 ? 'flight' : 'pre'

  const activeIndex = useMemo(() => {
    let idx = -1
    for (let i = 0; i < FALCON9_SEQUENCE.length; i++) {
      if (elapsed >= FALCON9_SEQUENCE[i].t) idx = i
      else break
    }
    return idx
  }, [elapsed])

  const activeEvent = activeIndex >= 0 ? FALCON9_SEQUENCE[activeIndex] : null
  const activeMeta = activeEvent ? stageMetaForEvent(activeEvent) : null

  // Retrigger callout animation whenever the active milestone advances.
  useEffect(() => {
    if (activeIndex !== prevActiveRef.current && activeIndex >= 0) {
      prevActiveRef.current = activeIndex
      setCalloutKey((k) => k + 1)
    }
  }, [activeIndex])

  const activeRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIndex])

  // Chapter headers: first index of each chapter in the sequence.
  const chapterStarts = useMemo(() => {
    const starts = new Set<number>()
    let prev: string | null = null
    FALCON9_SEQUENCE.forEach((e, i) => {
      const ch = stageMetaForEvent(e).chapter
      if (ch !== prev) {
        starts.add(i)
        prev = ch
      }
    })
    return starts
  }, [])

  return (
    <div
      className={`launchseq launchseq--${phase}${activeMeta ? ` launchseq--action-${activeMeta.action}` : ''}`}
      style={
        activeMeta
          ? ({ '--stage-accent': activeMeta.color } as CSSProperties)
          : undefined
      }
    >
      <div className="launchseq-head">
        <div className="launchseq-mission">{launch.mission}</div>
        <div className="launchseq-rocket">{launch.rocket}</div>
        <div className={`launchseq-phase-pill launchseq-phase-pill--${phase}`}>
          {phase === 'pre' ? 'COUNTDOWN' : 'FLIGHT'}
        </div>
      </div>

      <div className={`launchseq-clock${elapsed >= -60 && elapsed < 0 ? ' is-terminal' : ''}${elapsed >= 0 ? ' is-flight' : ''}`}>
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

      {activeEvent && activeMeta && (
        <div key={calloutKey} className="launchseq-callout" role="status" aria-live="polite">
          <span className="launchseq-callout-verb">{activeMeta.verb}</span>
          <span className="launchseq-callout-label">{activeEvent.label}</span>
          <span className="launchseq-callout-time">{offsetLabel(activeEvent.t)}</span>
        </div>
      )}

      <ul className="launchseq-list">
        {FALCON9_SEQUENCE.map((e, i) => {
          const meta = stageMetaForEvent(e)
          const showChapter = chapterStarts.has(i)
          const passed = i <= activeIndex
          const active = i === activeIndex
          return (
            <li key={`${e.label}-${e.t}`} className="launchseq-block">
              {showChapter && (
                <div className={`launchseq-chapter launchseq-chapter--${meta.chapter.toLowerCase()}`}>
                  {meta.chapter}
                </div>
              )}
              <div
                ref={active ? activeRef : undefined}
                className={`launchseq-item launchseq-item--${meta.action}${passed ? ' is-passed' : ''}${active ? ' is-active' : ''}`}
                style={{ '--item-accent': meta.color } as CSSProperties}
              >
                <span className="launchseq-bullet" />
                <span className="launchseq-evt">
                  <span className="launchseq-evt-verb">{meta.verb}</span>
                  <span className="launchseq-evt-name">{e.label}</span>
                </span>
                <span className="launchseq-evt-time">{offsetLabel(e.t)}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
