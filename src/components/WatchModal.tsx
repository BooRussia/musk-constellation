import { useEffect } from 'react'
import { X } from 'lucide-react'
import type { DetailedLaunch } from '../lib/launches'

interface Props {
  launch: DetailedLaunch
  onClose: () => void
}

/** Pop-up webcast player — embeds the YouTube stream when possible, else
 *  offers an external link (some webcasts aren't embeddable). */
export default function WatchModal({ launch, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="watch-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="watch-modal">
        <div className="watch-head">
          <span className="watch-title">
            <span className="watch-live">● LIVE</span> {launch.mission}
          </span>
          <button className="watch-close" onClick={onClose} aria-label="Close webcast">
            <X className="h-4 w-4" />
          </button>
        </div>
        {launch.webcastEmbed ? (
          <div className="watch-frame">
            <iframe
              src={`${launch.webcastEmbed}?autoplay=1`}
              title={`${launch.mission} webcast`}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
          </div>
        ) : (
          <div className="watch-noembed">
            <p>This webcast can’t be embedded here.</p>
            {launch.webcastUrl && (
              <a
                className="watch-extlink"
                href={launch.webcastUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open the stream ↗
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
