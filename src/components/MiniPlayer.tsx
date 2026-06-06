import { useRef, useState } from 'react'
import { ExternalLink, GripVertical, X } from 'lucide-react'
import type { DetailedLaunch } from '../lib/launches'

// Floating, draggable, resizable webcast mini-player. Embeds an actual
// YouTube livestream (so it plays in-page, unlike the X/SpaceX.com webcasts
// that block embedding) and can be parked anywhere on screen — so you can
// watch the stream while the launch plays out on the globe behind it.

// SpaceX's official YouTube channel. The live_stream embed shows whatever
// that channel is currently broadcasting — the reliable always-embeddable
// fallback when a launch has no per-mission YouTube link (its webcast is
// usually on X).
const SPACEX_CHANNEL = 'UCtI0Hodo5o5dUb67FeUjDeA'

const HEADER_H = 38
const MIN_W = 260
const MIN_H = 150

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function embedSrc(launch: DetailedLaunch): string {
  const base =
    launch.webcastEmbed ?? `https://www.youtube.com/embed/live_stream?channel=${SPACEX_CHANNEL}`
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}autoplay=1&rel=0&playsinline=1`
}

interface Props {
  launch: DetailedLaunch
  onClose: () => void
}

export default function MiniPlayer({ launch, onClose }: Props) {
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
  const [busy, setBusy] = useState(false) // dragging or resizing → shield the iframe

  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const sizeRef = useRef<{ px: number; py: number; ow: number; oh: number } | null>(null)

  const capture = (e: React.PointerEvent) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic / inactive pointer — capture is a nicety, drag still works */
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

  return (
    <div
      className="miniplayer"
      style={{ left: rect.x, top: rect.y, width: rect.w }}
    >
      <div
        className="miniplayer-head"
        onPointerDown={onDragDown}
        onPointerMove={onDragMove}
        onPointerUp={onDragUp}
        onPointerCancel={onDragUp}
      >
        <GripVertical className="miniplayer-grip h-3.5 w-3.5" aria-hidden="true" />
        <span className="miniplayer-title">
          <span className="miniplayer-live">● LIVE</span> {launch.mission}
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
        <iframe
          src={embedSrc(launch)}
          title={`${launch.mission} webcast`}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
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
