import { useEffect } from 'react'
import { ExternalLink, PlayCircle, X } from 'lucide-react'
import type { DetailedLaunch } from '../lib/launches'

interface Props {
  launch: DetailedLaunch
  onClose: () => void
}

/** Pop-up webcast player. Embeds a YouTube stream when one is available;
 *  otherwise (e.g. an X / SpaceX.com webcast that can't be iframed) it
 *  shows a clean "Watch on …" call-to-action that opens the real stream. */
export default function WatchModal({ launch, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const platform = launch.webcastPlatform ?? 'stream'

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
          <>
            <div className="watch-frame">
              <iframe
                src={`${launch.webcastEmbed}?autoplay=1&rel=0`}
                title={`${launch.mission} webcast`}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
              />
            </div>
            {launch.webcastUrl && (
              <a
                className="watch-backlink"
                href={launch.webcastUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-3 w-3" aria-hidden="true" /> Trouble playing? Open on{' '}
                {platform}
              </a>
            )}
          </>
        ) : (
          <div className="watch-noembed">
            <PlayCircle className="watch-noembed-icon h-10 w-10" aria-hidden="true" />
            <p className="watch-noembed-title">Live on {platform}</p>
            <p className="watch-noembed-sub">
              This webcast streams on {platform}, which doesn’t allow in-page embedding.
            </p>
            {launch.webcastUrl && (
              <a
                className="watch-cta"
                href={launch.webcastUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <PlayCircle className="h-4 w-4" aria-hidden="true" /> Watch on {platform} ↗
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
