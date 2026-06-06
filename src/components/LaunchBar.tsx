import { useEffect, useMemo, useState } from 'react'
import { CloudSun, Play, Rocket, X } from 'lucide-react'
import type { DetailedLaunch } from '../lib/launches'
import { fetchLaunchWeather, type LaunchWeather } from '../lib/weather'

// Top "launch ticker" bar. The live T-minus is the hero — big, bold, dead
// centre — with the mission identity + window on its left and the launch-site
// weather + Watch on its right. Real data from Launch Library 2 + Open-Meteo.

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

  return (
    <div className="launchbar launchbar--tracking">
      {/* Left — mission identity + window. */}
      <div className="launchbar-side launchbar-side--left">
        <div className="launchbar-id">
          <Rocket className="launchbar-rocket-icon h-4 w-4" aria-hidden="true" />
          <div className="launchbar-id-text">
            <div className="launchbar-mission">{launch.mission}</div>
            <div className="launchbar-sub">{launch.rocket}</div>
          </div>
        </div>
        {hasWindow && (
          <div className="launchbar-stat">
            <span className="launchbar-stat-k">Window</span>
            <span className="launchbar-stat-v">
              {fmtTime(launch.windowStart)}–{fmtTime(launch.windowEnd)}
            </span>
          </div>
        )}
        {launch.probability != null && (
          <div className="launchbar-stat">
            <span className="launchbar-stat-k">Go prob.</span>
            <span className="launchbar-stat-v">{launch.probability}%</span>
          </div>
        )}
      </div>

      {/* Centre — the hero T-minus. */}
      <div className="launchbar-center">
        <span className="launchbar-cd-sign">{sign}</span>
        <span className="launchbar-cd-time">{core}</span>
      </div>

      {/* Right — weather + Watch. */}
      <div className="launchbar-side launchbar-side--right">
        <div className="launchbar-stat launchbar-wx">
          <span className="launchbar-stat-k">
            <CloudSun className="h-3 w-3" aria-hidden="true" /> Weather
          </span>
          {wx ? (
            <span className="launchbar-stat-v">
              {imperial ? `${Math.round(wx.tempC * 1.8 + 32)}°F` : `${wx.tempC}°C`} ·{' '}
              {imperial ? `${Math.round(wx.windKmh * 0.621371)} mph` : `${wx.windKmh} km/h`}
              <span className={`launchbar-wx-tag launchbar-wx-tag--${wx.outlook.toLowerCase()}`}>
                {wx.outlook}
              </span>
            </span>
          ) : (
            <span className="launchbar-stat-v launchbar-stat-v--muted">—</span>
          )}
        </div>

        <button className="launchbar-watch" onClick={onWatch}>
          <Play className="h-3.5 w-3.5" aria-hidden="true" /> Watch
        </button>
        <button className="launchbar-exit" onClick={onExit} aria-label="Close launch tracker">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
