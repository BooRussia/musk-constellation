import { useEffect, useRef, useState } from 'react'
import { ExternalLink, GripVertical, X } from 'lucide-react'
import type { ReplayControl } from './LaunchReplay'
import {
  loadYouTubeApi,
  youtubeVideoId,
  YT_STATE,
  type YTPlayer,
} from '../lib/youtubePlayer'

// Floating, draggable, resizable webcast mini-player.
// Live mode: embeds the SpaceX livestream (or a per-mission YouTube link).
// Replay mode: YouTube IFrame API VOD synced bidirectionally with the
// launch simulation clock (scrub either side → the other follows).

const SPACEX_CHANNEL = 'UCtI0Hodo5o5dUb67FeUjDeA'
const HEADER_H = 38
const MIN_W = 260
const MIN_H = 150
/** How often we poll YT ↔ sim for drift (ms). */
const SYNC_MS = 250
/** Ignore echo seeks for this long after we drive the other side. */
const LOCK_MS = 700
/** Max YouTube playback rate we will request. */
const YT_MAX_RATE = 2

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export interface MiniPlayerLaunch {
  mission: string
  webcastUrl?: string
  webcastEmbed?: string
  /** Seconds into the VOD where T+0 occurs (optional; estimated if missing). */
  webcastLiftoffOffsetSec?: number
}

interface Props {
  launch: MiniPlayerLaunch
  onClose: () => void
  /** When set, player runs in synced replay mode against this control ref. */
  syncCtrlRef?: React.MutableRefObject<ReplayControl>
  /** Mission duration (seconds) — helps estimate liftoff offset in the VOD. */
  missionDurationSec?: number
}

function liveEmbedSrc(launch: MiniPlayerLaunch): string {
  const base =
    launch.webcastEmbed ?? `https://www.youtube.com/embed/live_stream?channel=${SPACEX_CHANNEL}`
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}autoplay=1&rel=0&playsinline=1`
}

/** Estimate where T+0 sits in a SpaceX VOD when we lack an explicit offset. */
function estimateLiftoffOffset(videoDur: number, missionDur: number, explicit?: number): number {
  if (explicit != null && Number.isFinite(explicit) && explicit >= 0) return explicit
  if (!(videoDur > 0)) return 0
  // Typical SpaceX VODs: countdown pre-roll, then flight ≈ missionDur, then a bit of outro.
  const estimated = videoDur - missionDur - 90
  if (estimated < 30) return 0 // already starts near liftoff
  return clamp(estimated, 0, 45 * 60)
}

export default function MiniPlayer({ launch, onClose, syncCtrlRef, missionDurationSec }: Props) {
  const synced = !!syncCtrlRef
  const videoId = synced ? youtubeVideoId(launch.webcastEmbed ?? launch.webcastUrl) : undefined

  const [rect, setRect] = useState(() => {
    const w = 384
    const h = 216
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
  const [error, setError] = useState<string | null>(null)

  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const offsetRef = useRef(0)
  const lockUntilRef = useRef(0)
  const lastVideoTRef = useRef(-1)
  const lastSimTRef = useRef(-1)
  const lastPlayingRef = useRef<boolean | null>(null)
  const lastSpeedRef = useRef<number | null>(null)

  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const sizeRef = useRef<{ px: number; py: number; ow: number; oh: number } | null>(null)

  // Mount YouTube IFrame API player for synced replay VODs.
  useEffect(() => {
    if (!synced || !videoId || !hostRef.current) return
    let cancelled = false
    let player: YTPlayer | null = null

    loadYouTubeApi()
      .then(() => {
        if (cancelled || !hostRef.current || !window.YT?.Player) return
        const startAt = Math.max(0, Math.floor(syncCtrlRef!.current.t))
        player = new window.YT.Player(hostRef.current, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 1,
            controls: 1,
            rel: 0,
            playsinline: 1,
            modestbranding: 1,
            enablejsapi: 1,
            origin: window.location.origin,
            start: startAt, // refined once duration/offset known
          },
          events: {
            onReady: (e) => {
              if (cancelled) return
              playerRef.current = e.target
              const dur = e.target.getDuration() || 0
              const mission =
                missionDurationSec ??
                (syncCtrlRef!.current.duration > 0 ? syncCtrlRef!.current.duration : 3900)
              offsetRef.current = estimateLiftoffOffset(
                dur,
                mission,
                launch.webcastLiftoffOffsetSec,
              )
              // Prefer starting at current sim time (T+), mapped into the VOD.
              const videoT = offsetRef.current + Math.max(0, syncCtrlRef!.current.t)
              lockUntilRef.current = performance.now() + LOCK_MS
              e.target.seekTo(videoT, true)
              if (syncCtrlRef!.current.playing) e.target.playVideo()
              else e.target.pauseVideo()
              // Cap sim speed to what YouTube can mirror while synced.
              if (syncCtrlRef!.current.speed > YT_MAX_RATE) {
                syncCtrlRef!.current.speed = 1
              }
              setReady(true)
            },
            onError: () => {
              if (!cancelled) setError('Webcast failed to load')
            },
          },
        })
      })
      .catch(() => {
        if (!cancelled) setError('Could not load YouTube player')
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
  }, [synced, videoId, launch.webcastLiftoffOffsetSec, missionDurationSec, syncCtrlRef])

  // Bidirectional sync loop: sim ↔ video.
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

      // --- Video → sim (user scrubbed / paused the YouTube UI) ---
      if (!locked) {
        const videoJumped =
          lastVideoTRef.current >= 0 && Math.abs(videoT - lastVideoTRef.current) > 1.25
        if (videoJumped && Number.isFinite(missionFromVideo)) {
          lockUntilRef.current = now + LOCK_MS
          c.seekTo = clamp(missionFromVideo, 0, c.duration || missionFromVideo)
          lastSimTRef.current = c.seekTo
        }
        // Play/pause from the video controls.
        if (lastPlayingRef.current != null && ytPlaying !== lastPlayingRef.current) {
          // Only mirror when the change didn't come from us.
          if (ytPlaying !== c.playing) {
            c.playing = ytPlaying
          }
        }
      }
      lastVideoTRef.current = videoT
      lastPlayingRef.current = ytPlaying

      // --- Sim → video (transport bar / scrubber / speed) ---
      if (!locked) {
        // Cap speed while synced — YouTube tops out around 2×.
        if (c.speed > YT_MAX_RATE) c.speed = YT_MAX_RATE

        if (lastSpeedRef.current !== c.speed) {
          lastSpeedRef.current = c.speed
          try {
            player.setPlaybackRate(clamp(c.speed, 0.25, YT_MAX_RATE))
          } catch {
            /* rate not supported for this video — ignore */
          }
        }

        if (c.playing !== ytPlaying) {
          lockUntilRef.current = now + LOCK_MS
          if (c.playing) player.playVideo()
          else player.pauseVideo()
        }

        const simT = c.t
        const expectedVideo = offsetRef.current + simT
        const drift = Math.abs(videoT - expectedVideo)
        const simJumped = lastSimTRef.current >= 0 && Math.abs(simT - lastSimTRef.current) > 0.9
        if ((simJumped || drift > 1.1) && Number.isFinite(expectedVideo)) {
          lockUntilRef.current = now + LOCK_MS
          player.seekTo(Math.max(0, expectedVideo), true)
          lastVideoTRef.current = expectedVideo
        }
        lastSimTRef.current = simT
      }
    }, SYNC_MS)
    return () => window.clearInterval(id)
  }, [synced, ready, syncCtrlRef])

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
            <span className="miniplayer-sync">SYNCED</span>
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
        {noEmbed || error ? (
          <div className="miniplayer-fallback">
            <div className="miniplayer-fallback-title">
              {error ?? 'No embeddable SpaceX stream for this launch'}
            </div>
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
        ) : synced ? (
          <div ref={hostRef} className="miniplayer-yt" />
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
