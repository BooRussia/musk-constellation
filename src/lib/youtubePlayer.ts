// ============================================
// youtubePlayer.ts — lazy-load the YouTube IFrame API
// ============================================
// Loads https://www.youtube.com/iframe_api once and resolves when
// window.YT.Player is ready. Used by the synced webcast mini-player.

export interface YTPlayer {
  destroy: () => void
  playVideo: () => void
  pauseVideo: () => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  getCurrentTime: () => number
  getDuration: () => number
  getPlayerState: () => number
  setPlaybackRate: (rate: number) => void
  getPlaybackRate: () => number
}

export interface YTPlayerVars {
  autoplay?: 0 | 1
  controls?: 0 | 1
  rel?: 0 | 1
  playsinline?: 0 | 1
  modestbranding?: 0 | 1
  origin?: string
  start?: number
  enablejsapi?: 0 | 1
}

export interface YTPlayerOptions {
  videoId: string
  width?: string | number
  height?: string | number
  playerVars?: YTPlayerVars
  events?: {
    onReady?: (e: { target: YTPlayer }) => void
    onStateChange?: (e: { data: number; target: YTPlayer }) => void
    onError?: (e: { data: number }) => void
  }
}

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement | string, opts: YTPlayerOptions) => YTPlayer
      PlayerState: {
        UNSTARTED: number
        ENDED: number
        PLAYING: number
        PAUSED: number
        BUFFERING: number
        CUED: number
      }
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

/** YouTube PlayerState values (mirrored so we don't depend on YT being loaded). */
export const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const

let apiPromise: Promise<void> | null = null

/** Ensure the YouTube IFrame API script is loaded. */
export function loadYouTubeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.YT?.Player) return Promise.resolve()
  if (apiPromise) return apiPromise

  apiPromise = new Promise<void>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve()
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-yt-api]')
    if (existing) return
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.async = true
    s.dataset.ytApi = '1'
    s.onerror = () => {
      apiPromise = null
      reject(new Error('YouTube IFrame API failed to load'))
    }
    document.head.appendChild(s)
  })
  return apiPromise
}

/** Extract an 11-char YouTube video id from a watch/embed/short URL. */
export function youtubeVideoId(url?: string): string | undefined {
  if (!url) return undefined
  const m =
    url.match(/[?&]v=([\w-]{11})/) ||
    url.match(/youtu\.be\/([\w-]{11})/) ||
    url.match(/youtube\.com\/(?:embed|live|shorts)\/([\w-]{11})/)
  return m?.[1]
}
