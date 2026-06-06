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
/** Time-of-day at the launch site (its local timezone), 12-hour. */
function fmtTime(iso: string | undefined, tz?: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    })
  } catch {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }
}

/** Short timezone label for the launch site (e.g. "PDT", "EDT", "GMT-8"). */
function tzAbbr(iso: string | undefined, tz?: string): string {
  if (!iso) return ''
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(new Date(iso))
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}

/** The launch site's IANA timezone, or a longitude-based fallback. */
function padTimeZone(launch: DetailedLaunch): string | undefined {
  if (launch.pad?.timezone) return launch.pad.timezone
  const lon = launch.pad?.lon
  if (lon != null && Number.isFinite(lon)) {
    const off = Math.round(lon / 15)
    if (off === 0) return 'UTC'
    // Etc/GMT signs are inverted (Etc/GMT+8 == UTC-8).
    return `Etc/GMT${off > 0 ? '-' : '+'}${Math.abs(off)}`
  }
  return undefined
}

/** Go-for-launch probability: the real LL2 figure when present, otherwise a
 *  weather-derived estimate (Starlink missions rarely carry an official %).
 *  Returns null until weather is available. */
function goProbability(
  probability: number | null,
  wx: LaunchWeather | null,
): number | null {
  if (probability != null) return probability
  if (!wx) return null
  const penalty = wx.precipProb * 0.6 + Math.max(0, wx.windKmh - 24) * 0.9
  return Math.round(Math.max(20, Math.min(98, 100 - penalty)))
}
/** Continuous red → orange → green by probability (no background; the text
 *  colour carries the meaning). Low % is red, easing through orange to green
 *  as the odds improve. */
function goColor(go: number): string {
  const t = Math.max(0, Math.min(1, (go - 35) / (92 - 35)))
  const hue = Math.round(t * 125) // 0 = red · ~30 orange · 125 green
  return `hsl(${hue}, 95%, 62%)`
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
  const go = goProbability(launch.probability, wx)
  const tz = padTimeZone(launch)

  return (
    <div className="launchbar launchbar--tracking">
      {/* Mission identity. */}
      <div className="launchbar-id">
        <Rocket className="launchbar-rocket-icon h-4 w-4" aria-hidden="true" />
        <div className="launchbar-id-text">
          <div className="launchbar-mission">{launch.mission}</div>
          <div className="launchbar-sub">{launch.rocket}</div>
        </div>
      </div>

      {hasWindow && (
        <>
          <span className="launchbar-divider" />
          <div className="launchbar-stat">
            <span className="launchbar-stat-k">Window</span>
            <span className="launchbar-stat-v">
              {fmtTime(launch.windowStart, tz)}–{fmtTime(launch.windowEnd, tz)}
            </span>
            {tzAbbr(launch.windowStart, tz) && (
              <span className="launchbar-stat-sub">{tzAbbr(launch.windowStart, tz)}</span>
            )}
          </div>
        </>
      )}

      {/* Hero T-minus. */}
      <span className="launchbar-divider" />
      <div className="launchbar-center">
        <span className="launchbar-cd-sign">{sign}</span>
        <span className="launchbar-cd-time">{core}</span>
      </div>
      <span className="launchbar-divider" />

      {/* Weather. */}
      <div className="launchbar-stat launchbar-wx">
        <span className="launchbar-stat-k">
          <CloudSun className="h-3 w-3" aria-hidden="true" /> Weather
        </span>
        {wx ? (
          <span className="launchbar-stat-v">
            {imperial ? `${Math.round(wx.tempC * 1.8 + 32)}°F` : `${wx.tempC}°C`} ·{' '}
            {imperial ? `${Math.round(wx.windKmh * 0.621371)} mph` : `${wx.windKmh} km/h`}
          </span>
        ) : (
          <span className="launchbar-stat-v launchbar-stat-v--muted">—</span>
        )}
      </div>

      {/* Go-for-launch probability — colour reflects the odds. */}
      {go != null && (
        <div className="launchbar-stat">
          <span className="launchbar-stat-k">Probability</span>
          <span className="launchbar-go-text" style={{ color: goColor(go) }}>
            {go}% Go for Launch
          </span>
        </div>
      )}

      {/* Actions. */}
      <span className="launchbar-divider" />
      <div className="launchbar-end">
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
