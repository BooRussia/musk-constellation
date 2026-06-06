import { useEffect, useMemo, useState } from 'react'
import { CloudSun, Play, Rocket, X } from 'lucide-react'
import type { DetailedLaunch } from '../lib/launches'
import { fetchLaunchWeather, type LaunchWeather } from '../lib/weather'

// Top "launch ticker" bar — mission · live T-minus · window · go-prob ·
// live launch-site weather · Watch. Real data from Launch Library 2 +
// Open-Meteo. Laid out in clean divider-separated groups.

const WEATHER_REFRESH_MS = 15 * 60 * 1000

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function countdown(ms: number): { sign: string; core: string } {
  const past = ms < 0
  let s = Math.floor(Math.abs(ms) / 1000)
  const d = Math.floor(s / 86400)
  s -= d * 86400
  const h = Math.floor(s / 3600)
  s -= h * 3600
  const m = Math.floor(s / 60)
  s -= m * 60
  const core = d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`
  return { sign: past ? 'T+' : 'T-', core }
}
function fmtTime(iso?: string): string {
  return iso
    ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : '—'
}

interface Props {
  launch: DetailedLaunch | null
  onWatch: () => void
  onExit: () => void
  /** Show temperatures in °F and wind in mph instead of °C / km/h. */
  imperial: boolean
}

export default function LaunchBar({ launch, onWatch, onExit, imperial }: Props) {
  const [nowMs, setNowMs] = useState(0)
  const [wx, setWx] = useState<LaunchWeather | null>(null)

  useEffect(() => {
    const tick = () => setNowMs(Date.now())
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [])

  // Live launch-site weather, refreshed every 15 min.
  const padLat = launch?.pad?.lat
  const padLon = launch?.pad?.lon
  const net = launch?.net
  useEffect(() => {
    if (padLat == null || padLon == null || !net) return
    let cancelled = false
    const load = () =>
      fetchLaunchWeather(padLat, padLon, net).then((w) => {
        if (!cancelled) setWx(w)
      })
    load()
    const id = window.setInterval(load, WEATHER_REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [padLat, padLon, net])

  const netMs = useMemo(() => (launch ? new Date(launch.net).getTime() : 0), [launch])

  if (!launch) {
    return (
      <div className="launchbar launchbar--loading">
        <Rocket className="h-4 w-4" aria-hidden="true" />
        <span>Loading next SpaceX launch…</span>
        <button className="launchbar-exit" onClick={onExit} aria-label="Close launch tracker">
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  const { sign, core } = countdown(netMs - nowMs)
  const hasWindow = launch.windowStart && launch.windowEnd
  const canWatch = !!(launch.webcastEmbed || launch.webcastUrl)

  return (
    <div className="launchbar">
      <div className="launchbar-id">
        <Rocket className="launchbar-rocket-icon h-4 w-4" aria-hidden="true" />
        <div className="launchbar-id-text">
          <div className="launchbar-mission">{launch.mission}</div>
          <div className="launchbar-sub">{launch.rocket}</div>
        </div>
      </div>

      <span className="launchbar-divider" />

      <div className="launchbar-cd">
        <span className="launchbar-cd-sign">{sign}</span>
        <span className="launchbar-cd-time">{core}</span>
      </div>

      <span className="launchbar-divider" />

      <div className="launchbar-stats">
        {hasWindow && (
          <div className="launchbar-stat">
            <span className="launchbar-stat-k">Window</span>
            <span className="launchbar-stat-v">
              {fmtTime(launch.windowStart)}–{fmtTime(launch.windowEnd)}
            </span>
          </div>
        )}

        {/* Go probability only when the feed actually has it (Starlink
            launches don't, so the stat is hidden rather than showing "—"). */}
        {launch.probability != null && (
          <div className="launchbar-stat">
            <span className="launchbar-stat-k">Go prob.</span>
            <span className="launchbar-stat-v">{launch.probability}%</span>
          </div>
        )}

        <div className="launchbar-stat launchbar-wx">
          <span className="launchbar-stat-k">
            <CloudSun className="h-3 w-3" aria-hidden="true" /> Weather
          </span>
          {wx ? (
            <span className="launchbar-stat-v">
              {imperial ? `${Math.round(wx.tempC * 1.8 + 32)}°F` : `${wx.tempC}°C`} ·{' '}
              {imperial ? `${Math.round(wx.windKmh * 0.621371)} mph` : `${wx.windKmh} km/h`} ·{' '}
              {wx.precipProb}%
              <span className={`launchbar-wx-tag launchbar-wx-tag--${wx.outlook.toLowerCase()}`}>
                {wx.outlook}
              </span>
            </span>
          ) : (
            <span className="launchbar-stat-v launchbar-stat-v--muted">—</span>
          )}
        </div>
      </div>

      <div className="launchbar-actions">
        {canWatch && (
          <button className="launchbar-watch" onClick={onWatch}>
            <Play className="h-3.5 w-3.5" aria-hidden="true" /> Watch Launch
          </button>
        )}
        <button className="launchbar-exit" onClick={onExit} aria-label="Close launch tracker">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
