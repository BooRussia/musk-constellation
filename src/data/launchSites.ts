// ============================================
// LAUNCH SITES — orbital + notable rocket launch sites worldwide
// ============================================
// Every country/agency that has reached (or attempted) orbit, plus a few
// notable suborbital/spaceports. Coordinates are the pad/center location.
// tier 0 = name always shown; tier 1 = name appears as you zoom in (the
// marker dot is always shown for both).

export interface LaunchSite {
  name: string
  /** Country (or territory) the pad sits in. */
  country: string
  lat: number
  lon: number
  tier: 0 | 1
  /** Operator / agency / note. */
  note: string
}

export const LAUNCH_SITES: LaunchSite[] = [
  // ---- United States ----
  { name: 'Cape Canaveral', country: 'USA', lat: 28.49, lon: -80.58, tier: 0, note: 'Cape Canaveral SFS / Kennedy Space Center' },
  { name: 'Starbase', country: 'USA', lat: 25.997, lon: -97.155, tier: 0, note: 'SpaceX — Boca Chica, Texas' },
  { name: 'Vandenberg', country: 'USA', lat: 34.742, lon: -120.572, tier: 0, note: 'Vandenberg SFB, California' },
  { name: 'Wallops', country: 'USA', lat: 37.94, lon: -75.466, tier: 1, note: 'Wallops Flight Facility, Virginia' },
  { name: 'Kodiak', country: 'USA', lat: 57.435, lon: -152.337, tier: 1, note: 'Pacific Spaceport Complex, Alaska' },
  { name: 'Spaceport America', country: 'USA', lat: 32.99, lon: -106.975, tier: 1, note: 'New Mexico — suborbital' },

  // ---- Russia / Kazakhstan ----
  { name: 'Baikonur', country: 'Kazakhstan', lat: 45.965, lon: 63.305, tier: 0, note: 'Baikonur Cosmodrome (Russia-operated)' },
  { name: 'Plesetsk', country: 'Russia', lat: 62.927, lon: 40.575, tier: 1, note: 'Plesetsk Cosmodrome' },
  { name: 'Vostochny', country: 'Russia', lat: 51.884, lon: 128.334, tier: 1, note: 'Vostochny Cosmodrome' },
  { name: 'Kapustin Yar', country: 'Russia', lat: 48.57, lon: 46.295, tier: 1, note: 'Kapustin Yar' },

  // ---- China ----
  { name: 'Wenchang', country: 'China', lat: 19.614, lon: 110.951, tier: 0, note: 'Wenchang Space Launch Site, Hainan' },
  { name: 'Jiuquan', country: 'China', lat: 40.958, lon: 100.291, tier: 0, note: 'Jiuquan Satellite Launch Center' },
  { name: 'Xichang', country: 'China', lat: 28.246, lon: 102.027, tier: 1, note: 'Xichang Satellite Launch Center' },
  { name: 'Taiyuan', country: 'China', lat: 38.849, lon: 111.608, tier: 1, note: 'Taiyuan Satellite Launch Center' },

  // ---- Europe / ESA ----
  { name: 'Kourou', country: 'French Guiana', lat: 5.236, lon: -52.768, tier: 0, note: 'Guiana Space Centre — ESA / Arianespace' },
  { name: 'SaxaVord', country: 'UK', lat: 60.69, lon: -0.77, tier: 1, note: 'SaxaVord Spaceport, Shetland' },
  { name: 'Esrange', country: 'Sweden', lat: 67.893, lon: 21.106, tier: 1, note: 'Esrange Space Center — suborbital' },
  { name: 'Andøya', country: 'Norway', lat: 69.294, lon: 16.02, tier: 1, note: 'Andøya Spaceport' },
  { name: 'Hammaguir', country: 'Algeria', lat: 30.9, lon: -3.04, tier: 1, note: 'Hammaguir — France’s first orbital site (1965)' },

  // ---- Japan ----
  { name: 'Tanegashima', country: 'Japan', lat: 30.4, lon: 130.97, tier: 0, note: 'Tanegashima Space Center — JAXA' },
  { name: 'Uchinoura', country: 'Japan', lat: 31.251, lon: 131.079, tier: 1, note: 'Uchinoura Space Center' },

  // ---- India ----
  { name: 'Sriharikota', country: 'India', lat: 13.733, lon: 80.235, tier: 0, note: 'Satish Dhawan Space Centre — ISRO' },

  // ---- Korea ----
  { name: 'Naro', country: 'South Korea', lat: 34.432, lon: 127.535, tier: 1, note: 'Naro Space Center' },
  { name: 'Sohae', country: 'North Korea', lat: 39.66, lon: 124.705, tier: 1, note: 'Sohae Satellite Launching Station' },

  // ---- Middle East ----
  { name: 'Palmachim', country: 'Israel', lat: 31.884, lon: 34.68, tier: 1, note: 'Palmachim Airbase' },
  { name: 'Semnan', country: 'Iran', lat: 35.234, lon: 53.921, tier: 1, note: 'Imam Khomeini Spaceport' },

  // ---- Southern hemisphere ----
  { name: 'Māhia', country: 'New Zealand', lat: -39.262, lon: 177.865, tier: 0, note: 'Rocket Lab Launch Complex 1' },
  { name: 'Alcântara', country: 'Brazil', lat: -2.373, lon: -44.396, tier: 1, note: 'Alcântara Launch Center' },
  { name: 'Woomera', country: 'Australia', lat: -30.955, lon: 136.532, tier: 1, note: 'Woomera Range — UK Black Arrow (1971)' },
  { name: 'Whalers Way', country: 'Australia', lat: -34.94, lon: 135.63, tier: 1, note: 'Southern Launch' },
  { name: 'San Marco', country: 'Kenya', lat: -2.94, lon: 40.21, tier: 1, note: 'San Marco platform — Italy (offshore)' },
]
