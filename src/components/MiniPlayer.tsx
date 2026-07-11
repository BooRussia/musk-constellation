import { useEffect, useRef, useState } from 'react'
import { Crosshair, ExternalLink, GripVertical, X } from 'lucide-react'
import type { ReplayControl } from './LaunchReplay'
import {
  loadYouTubeApi,
  youtubeVideoId,
  YT_STATE,
  type YTPlayer,
} from '../lib/youtubePlayer'

// Floating, draggable, resizable webcast mini-player.
// Live mode: embeds the SpaceX livestream (or a per-mission YouTube link).
// Replay mode: VOD iframe + YouTube IFrame API, bidirectionally scrub-synced
// to the simulation. Liftoff in the VOD is almost never at 0:00 (countdown /
// intro), so we resolve an offset and let the user Mark liftoff to calibrate.

const SPACEX_CHANNEL = 'UCtI0Hodo5o5dUb67FeUjDeA'
const HEADER_H = 38
const MIN_W = 280
const MIN_H = 150
const SYNC_MS = 250
const LOCK_MS = 700
const YT_MAX_RATE = 2
const OFFSET_STORE_KEY = 'mc.webcast.liftoffOffset.v1'
const LIVE_DELAY_STORE_KEY = 'mc.webcast.liveDelay.v1'
/** Typical YouTube live broadcast delay — used when Watch opens. */
export const DEFAULT_LIVE_STREAM_DELAY_SEC = 30
const LIVE_DELAY_MIN = 0
const LIVE_DELAY_MAX = 90

function loadStoredLiveDelay(): number | null {
  try {
    const raw = localStorage.getItem(LIVE_DELAY_STORE_KEY)
    if (raw == null) return null
    const v = Number(raw)
    return Number.isFinite(v) ? clamp(v, LIVE_DELAY_MIN, LIVE_DELAY_MAX) : null
  } catch {
    return null
  }
}

function saveStoredLiveDelay(sec: number): void {
  try {
    localStorage.setItem(LIVE_DELAY_STORE_KEY, String(Math.round(sec)))
  } catch {
    /* ignore */
  }
}

/** Preferred initial live-stream delay (saved preference or default 30s). */
export function initialLiveStreamDelaySec(): number {
  return loadStoredLiveDelay() ?? DEFAULT_LIVE_STREAM_DELAY_SEC
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function loadStoredOffset(videoId: string): number | null {
  try {
    const raw = localStorage.getItem(OFFSET_STORE_KEY)
    if (!raw) return null
    const map = JSON.parse(raw) as Record<string, number>
    const v = map[videoId]
    return typeof v === 'number' && v >= 0 ? v : null
  } catch {
    return null
  }
}

function saveStoredOffset(videoId: string, offset: number): void {
  try {
    const raw = localStorage.getItem(OFFSET_STORE_KEY)
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {}
    map[videoId] = Math.round(offset)
    localStorage.setItem(OFFSET_STORE_KEY, JSON.stringify(map))
  } catch {
    /* private mode / quota — ignore */
  }
}

export interface MiniPlayerLaunch {
  mission: string
  webcastUrl?: string
  webcastEmbed?: string
  webcastLiftoffOffsetSec?: number
}

interface Props {
  launch: MiniPlayerLaunch
  onClose: () => void
  syncCtrlRef?: React.MutableRefObject<ReplayControl>
  missionDurationSec?: number
  /**
   * LIVE mode only — seconds to hold the globe sim behind real NET so it
   * matches YouTube livestream delay.
   */
  liveStreamDelaySec?: number
  onLiveStreamDelayChange?: (sec: number) => void
  /** Liftoff NET (ms epoch) — used by "I just saw liftoff" calibration. */
  liveNetMs?: number
}

function liveEmbedSrc(launch: MiniPlayerLaunch): string {
  const base =
    launch.webcastEmbed ?? `https://www.youtube.com/embed/live_stream?channel=${SPACEX_CHANNEL}`
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}autoplay=1&rel=0&playsinline=1`
}

function vodEmbedSrc(videoId: string, startSec: number): string {
  const origin = typeof window !== 'undefined' ? encodeURIComponent(window.location.origin) : ''
  const start = Math.max(0, Math.floor(startSec))
  return (
    `https://www.youtube.com/embed/${videoId}` +
    `?autoplay=1&rel=0&playsinline=1&modestbranding=1&enablejsapi=1` +
    `&start=${start}` +
    (origin ? `&origin=${origin}` : '')
  )
}

/**
 * Resolve seconds into the VOD where T+0 (liftoff) occurs.
 * Priority: explicit bake → localStorage calibration → duration heuristic.
 *
 * Short rehosts (Space Devs etc., often ~15–25 min) have a brief intro then
 * liftoff — NOT videoDur−missionDur (that goes negative → 0 and desyncs).
 * Full webcasts (1h+) have a long countdown pre-roll.
 */
function resolveLiftoffOffset(opts: {
  videoId: string
  videoDur: number
  missionDur: number
  explicit?: number
}): { offset: number; source: 'baked' | 'saved' | 'estimated' | 'unknown' } {
  const { videoId, videoDur, missionDur, explicit } = opts
  if (explicit != null && Number.isFinite(explicit) && explicit >= 0) {
    return { offset: explicit, source: 'baked' }
  }
  const saved = loadStoredOffset(videoId)
  if (saved != null) return { offset: saved, source: 'saved' }

  if (!(videoDur > 0)) return { offset: 0, source: 'unknown' }

  // Full-length webcast: countdown + flight ≈ mission + outro.
  if (videoDur >= Math.max(45 * 60, missionDur * 0.75)) {
    const estimated = videoDur - missionDur - 120
    if (estimated >= 60) {
      return { offset: clamp(estimated, 60, 50 * 60), source: 'estimated' }
    }
  }

  // Short highlight / rehost: intro is usually a couple minutes, not zero.
  // Prefer aligning via Mark liftoff — use a modest default so we're closer.
  if (videoDur < 40 * 60) {
    // Assume ~2.5 min intro when we have no better signal.
    const guess = clamp(Math.min(150, videoDur * 0.12), 45, 240)
    return { offset: guess, source: 'estimated' }
  }

  return { offset: 0, source: 'unknown' }
}

function waitForDuration(player: YTPlayer, timeoutMs = 8000): Promise<number> {
  return new Promise((resolve) => {
    const start = performance.now()
    const tick = () => {
      try {
        const d = player.getDuration() || 0
        if (d > 1) {
          resolve(d)
          return
        }
      } catch {
        /* not ready */
      }
      if (performance.now() - start > timeoutMs) {
        resolve(0)
        return
      }
      window.setTimeout(tick, 200)
    }
    tick()
  })
}

export default function MiniPlayer({
  launch,
  onClose,
  syncCtrlRef,
  missionDurationSec,
  liveStreamDelaySec,
  onLiveStreamDelayChange,
  liveNetMs,
}: Props) {
  const synced = !!syncCtrlRef
  const liveDelayMode =
    !synced && liveStreamDelaySec != null && typeof onLiveStreamDelayChange === 'function'
  const videoId = synced ? youtubeVideoId(launch.webcastEmbed ?? launch.webcastUrl) : undefined

  const [rect, setRect] = useState(() => {
    const w = 400
    const h = 225
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
    return {
      w,
      h,
      x: Math.max(12, vw - w - 24),
      y: Math.max(70, vh - (h + HEADER_H) - 24),
    }
  })
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [needsAlign, setNeedsAlign] = useState(false)
  const [offsetLabel, setOffsetLabel] = useState<string | null>(null)

  const [vodSrc] = useState(() => (synced && videoId ? vodEmbedSrc(videoId, 0) : null))

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const offsetRef = useRef(0)
  const lockUntilRef = useRef(0)
  const lastVideoTRef = useRef(-1)
  const lastSimTRef = useRef(-1)
  const lastPlayingRef = useRef<boolean | null>(null)
  const lastSpeedRef = useRef<number | null>(null)

  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const sizeRef = useRef<{ px: number; py: number; ow: number; oh: number } | null>(null)

  const applyOffsetAndSeek = (offset: number, player: YTPlayer) => {
    if (!syncCtrlRef) return
    offsetRef.current = Math.max(0, offset)
    const videoT = offsetRef.current + Math.max(0, syncCtrlRef.current.t)
    lockUntilRef.current = performance.now() + LOCK_MS
    try {
      player.seekTo(videoT, true)
      if (syncCtrlRef.current.playing) player.playVideo()
      else player.pauseVideo()
    } catch {
      /* ignore */
    }
    const m = Math.floor(offsetRef.current / 60)
    const s = Math.floor(offsetRef.current % 60)
    setOffsetLabel(`T+0 @ ${m}:${String(s).padStart(2, '0')}`)
  }

  // Attach YouTube IFrame API to the already-visible iframe for sync control.
  useEffect(() => {
    if (!synced || !videoId || !iframeRef.current) return
    let cancelled = false
    let player: YTPlayer | null = null

    const el = iframeRef.current
    if (!el.id) el.id = `yt-sync-${videoId}`

    loadYouTubeApi()
      .then(async () => {
        if (cancelled || !window.YT?.Player) return
        const iframe = iframeRef.current
        if (!iframe) return

        player = new window.YT.Player(iframe, {
          events: {
            onReady: async (e) => {
              if (cancelled) return
              playerRef.current = e.target
              const dur = await waitForDuration(e.target)
              if (cancelled) return
              const mission =
                missionDurationSec ??
                (syncCtrlRef!.current.duration > 0 ? syncCtrlRef!.current.duration : 3900)
              const resolved = resolveLiftoffOffset({
                videoId,
                videoDur: dur,
                missionDur: mission,
                explicit: launch.webcastLiftoffOffsetSec,
              })
              // Short VODs with only a guess still benefit from Mark liftoff.
              setNeedsAlign(resolved.source === 'estimated' || resolved.source === 'unknown')
              applyOffsetAndSeek(resolved.offset, e.target)
              if (syncCtrlRef!.current.speed > YT_MAX_RATE) {
                syncCtrlRef!.current.speed = 1
              }
              setReady(true)
            },
          },
        })
      })
      .catch(() => {
        if (!cancelled) setReady(false)
      })

    return () => {
      cancelled = true
      playerRef.current = null
      try {
        player?.destroy()
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once per video
  }, [synced, videoId, launch.webcastLiftoffOffsetSec, missionDurationSec, syncCtrlRef])

  // Bidirectional sync loop.
  useEffect(() => {
    if (!synced || !ready || !syncCtrlRef) return
    const id = window.setInterval(() => {
      const player = playerRef.current
      const c = syncCtrlRef.current
      if (!player) return
      const now = performance.now()
      const locked = now < lockUntilRef.current

      let videoT: number
      let state: number
      try {
        videoT = player.getCurrentTime()
        state = player.getPlayerState()
      } catch {
        return
      }

      const missionFromVideo = videoT - offsetRef.current
      const ytPlaying = state === YT_STATE.PLAYING || state === YT_STATE.BUFFERING

      if (!locked) {
        const videoJumped =
          lastVideoTRef.current >= 0 && Math.abs(videoT - lastVideoTRef.current) > 1.25
        if (videoJumped && Number.isFinite(missionFromVideo)) {
          lockUntilRef.current = now + LOCK_MS
          c.seekTo = clamp(missionFromVideo, 0, c.duration || Math.max(0, missionFromVideo))
          lastSimTRef.current = c.seekTo
        }
        if (lastPlayingRef.current != null && ytPlaying !== lastPlayingRef.current) {
          if (ytPlaying !== c.playing) c.playing = ytPlaying
        }
      }
      lastVideoTRef.current = videoT
      lastPlayingRef.current = ytPlaying

      if (!locked) {
        if (c.speed > YT_MAX_RATE) c.speed = YT_MAX_RATE
        if (lastSpeedRef.current !== c.speed) {
          lastSpeedRef.current = c.speed
          try {
            player.setPlaybackRate(clamp(c.speed, 0.25, YT_MAX_RATE))
          } catch {
            /* ignore */
          }
        }
        if (c.playing !== ytPlaying) {
          lockUntilRef.current = now + LOCK_MS
          try {
            if (c.playing) player.playVideo()
            else player.pauseVideo()
          } catch {
            /* ignore */
          }
        }
        const simT = c.t
        const expectedVideo = offsetRef.current + simT
        const drift = Math.abs(videoT - expectedVideo)
        const simJumped = lastSimTRef.current >= 0 && Math.abs(simT - lastSimTRef.current) > 0.9
        if ((simJumped || drift > 1.1) && Number.isFinite(expectedVideo)) {
          lockUntilRef.current = now + LOCK_MS
          try {
            player.seekTo(Math.max(0, expectedVideo), true)
            lastVideoTRef.current = expectedVideo
          } catch {
            /* ignore */
          }
        }
        lastSimTRef.current = simT
      }
    }, SYNC_MS)
    return () => window.clearInterval(id)
  }, [synced, ready, syncCtrlRef])

  /** User saw liftoff in the stream — map that video time to T+0. */
  const markLiftoff = () => {
    const player = playerRef.current
    if (!player || !videoId || !syncCtrlRef) return
    let videoT: number
    try {
      videoT = player.getCurrentTime()
    } catch {
      return
    }
    // Current frame = liftoff → offset is video clock; snap sim to T+0.
    const offset = Math.max(0, videoT)
    saveStoredOffset(videoId, offset)
    syncCtrlRef.current.seekTo = 0
    syncCtrlRef.current.playing = true
    applyOffsetAndSeek(offset, player)
    setNeedsAlign(false)
    setReady(true)
  }

  const capture = (e: React.PointerEvent) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }
  const release = (e: React.PointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const onDragDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    capture(e)
    dragRef.current = { px: e.clientX, py: e.clientY, ox: rect.x, oy: rect.y }
    setBusy(true)
  }
  const onDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    setRect((r) => ({
      ...r,
      x: clamp(d.ox + (e.clientX - d.px), 0, window.innerWidth - r.w),
      y: clamp(d.oy + (e.clientY - d.py), 0, window.innerHeight - (r.h + HEADER_H)),
    }))
  }
  const onDragUp = (e: React.PointerEvent) => {
    dragRef.current = null
    setBusy(false)
    release(e)
  }

  const onResizeDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    capture(e)
    sizeRef.current = { px: e.clientX, py: e.clientY, ow: rect.w, oh: rect.h }
    setBusy(true)
  }
  const onResizeMove = (e: React.PointerEvent) => {
    const s = sizeRef.current
    if (!s) return
    setRect((r) => ({
      ...r,
      w: clamp(s.ow + (e.clientX - s.px), MIN_W, window.innerWidth - r.x - 8),
      h: clamp(s.oh + (e.clientY - s.py), MIN_H, window.innerHeight - r.y - HEADER_H - 8),
    }))
  }
  const onResizeUp = (e: React.PointerEvent) => {
    sizeRef.current = null
    setBusy(false)
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  const noEmbed = synced && !videoId

  return (
    <div className="miniplayer" style={{ left: rect.x, top: rect.y, width: rect.w }}>
      <div
        className="miniplayer-head"
        onPointerDown={onDragDown}
        onPointerMove={onDragMove}
        onPointerUp={onDragUp}
        onPointerCancel={onDragUp}
      >
        <GripVertical className="miniplayer-grip h-3.5 w-3.5" aria-hidden="true" />
        <span className="miniplayer-title">
          {synced ? (
            <span className={`miniplayer-sync${ready ? ' is-ready' : ''}`}>
              {ready ? 'SYNCED' : 'STREAM'}
            </span>
          ) : (
            <span className="miniplayer-live">● LIVE</span>
          )}{' '}
          {launch.mission}
        </span>
        <div className="miniplayer-actions">
          {launch.webcastUrl && (
            <a
              className="miniplayer-pop"
              href={launch.webcastUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open webcast in a new tab"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <button
            className="miniplayer-close"
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Close mini-player"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="miniplayer-body" style={{ height: rect.h }}>
        {noEmbed ? (
          <div className="miniplayer-fallback">
            <div className="miniplayer-fallback-title">No embeddable SpaceX stream for this launch</div>
            <div className="miniplayer-fallback-sub">
              {launch.webcastUrl
                ? 'Open the original webcast in a new tab — X streams can’t play in-app.'
                : 'This past launch has no archived YouTube webcast.'}
            </div>
            {launch.webcastUrl && (
              <a
                className="miniplayer-fallback-cta"
                href={launch.webcastUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open webcast
              </a>
            )}
          </div>
        ) : synced && vodSrc ? (
          <iframe
            ref={iframeRef}
            src={vodSrc}
            title={`${launch.mission} webcast`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : (
          <iframe
            src={liveEmbedSrc(launch)}
            title={`${launch.mission} webcast`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        )}
        {busy && <div className="miniplayer-shield" />}
      </div>

      {synced && !noEmbed && (
        <div className="miniplayer-syncbar">
          <button
            type="button"
            className={`miniplayer-align${needsAlign ? ' is-needed' : ''}`}
            onClick={markLiftoff}
            title="Scrub the video to the moment of liftoff, then click — locks T+0 to that frame"
          >
            <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
            Mark liftoff
          </button>
          <span className="miniplayer-syncbar-hint">
            {needsAlign
              ? 'Scrub to liftoff in the stream, then mark it'
              : offsetLabel
                ? `Aligned · ${offsetLabel}`
                : 'Stream locked to mission clock'}
          </span>
        </div>
      )}

      {liveDelayMode && (
        <div className="miniplayer-syncbar miniplayer-syncbar--live">
          <button
            type="button"
            className="miniplayer-align is-needed"
            onClick={() => {
              if (liveNetMs == null || !onLiveStreamDelayChange) return
              // Wall-clock seconds since NET when the user sees liftoff on stream
              // ≈ how far behind the livestream is.
              const delay = clamp(
                Math.round((Date.now() - liveNetMs) / 1000),
                LIVE_DELAY_MIN,
                LIVE_DELAY_MAX,
              )
              saveStoredLiveDelay(delay)
              onLiveStreamDelayChange(delay)
            }}
            title="Click the moment you see liftoff on the stream — holds the sim to match"
            disabled={liveNetMs == null || Date.now() < (liveNetMs ?? 0)}
          >
            <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
            Saw liftoff
          </button>
          <label className="miniplayer-delay">
            <span className="miniplayer-delay-lab">Delay</span>
            <input
              type="range"
              min={LIVE_DELAY_MIN}
              max={LIVE_DELAY_MAX}
              step={1}
              value={liveStreamDelaySec ?? DEFAULT_LIVE_STREAM_DELAY_SEC}
              onChange={(e) => {
                const v = Number(e.target.value)
                saveStoredLiveDelay(v)
                onLiveStreamDelayChange?.(v)
              }}
              aria-label="Livestream delay in seconds"
            />
            <span className="miniplayer-delay-val">{liveStreamDelaySec ?? 0}s</span>
          </label>
          <span className="miniplayer-syncbar-hint">
            Holds the globe behind real time to match YouTube’s broadcast delay
          </span>
        </div>
      )}

      <div
        className="miniplayer-resize"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        onPointerCancel={onResizeUp}
        aria-hidden="true"
      />
    </div>
  )
}
