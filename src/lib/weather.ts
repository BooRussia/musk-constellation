// ============================================
// Launch-window weather — Open-Meteo
// ============================================
// Free, no API key, CORS-enabled. We pull the hourly forecast at the pad's
// lat/lon and read the hour closest to the launch's net time, so the bar
// shows the conditions expected during the window. Refreshed periodically
// by the caller.

export interface LaunchWeather {
  tempC: number
  windKmh: number
  precipProb: number
  cloudPct: number
  /** Coarse read of the window: 'Favorable' | 'Marginal' | 'Rough'. */
  outlook: 'Favorable' | 'Marginal' | 'Rough'
}

/** Fetch the forecast at (lat,lon) for the hour nearest `isoTime`. Returns
 *  null if the forecast doesn't reach that far out (>16 days) or on error. */
export async function fetchLaunchWeather(
  lat: number,
  lon: number,
  isoTime: string,
): Promise<LaunchWeather | null> {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
    '&hourly=temperature_2m,precipitation_probability,cloud_cover,wind_speed_10m' +
    '&wind_speed_unit=kmh&forecast_days=16&timezone=UTC'
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const j = (await res.json()) as {
      hourly?: {
        time?: string[]
        temperature_2m?: number[]
        precipitation_probability?: number[]
        cloud_cover?: number[]
        wind_speed_10m?: number[]
      }
    }
    const times = j.hourly?.time
    if (!times?.length) return null
    const target = new Date(isoTime).getTime()
    if (!Number.isFinite(target)) return null
    let bi = 0
    let bd = Infinity
    for (let i = 0; i < times.length; i++) {
      const d = Math.abs(new Date(`${times[i]}Z`).getTime() - target)
      if (d < bd) {
        bd = d
        bi = i
      }
    }
    // If the nearest forecast hour is more than a day off, the window is
    // beyond the model's reach — don't show stale numbers.
    if (bd > 24 * 60 * 60 * 1000) return null

    const tempC = Math.round(j.hourly?.temperature_2m?.[bi] ?? NaN)
    const windKmh = Math.round(j.hourly?.wind_speed_10m?.[bi] ?? NaN)
    const precipProb = Math.round(j.hourly?.precipitation_probability?.[bi] ?? 0)
    const cloudPct = Math.round(j.hourly?.cloud_cover?.[bi] ?? 0)
    if (!Number.isFinite(tempC) || !Number.isFinite(windKmh)) return null

    const outlook: LaunchWeather['outlook'] =
      precipProb >= 50 || windKmh >= 38
        ? 'Rough'
        : precipProb >= 25 || windKmh >= 24 || cloudPct >= 85
          ? 'Marginal'
          : 'Favorable'

    return { tempC, windKmh, precipProb, cloudPct, outlook }
  } catch {
    return null
  }
}
