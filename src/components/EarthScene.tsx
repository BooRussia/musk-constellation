import { Suspense, useRef, useMemo, useEffect, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Stars as DreiStars } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import SatelliteCloud from './SatelliteCloud'
import MapEarth from './MapEarth'
import KeyboardCameraControls from './KeyboardCameraControls'
import GlobeLabels from './GlobeLabels'
import OrbitTrails from './OrbitTrails'
import type { SatelliteEntry, ConstellationKey } from '../lib/tle'

export type EarthViewMode = 'satellite' | 'map'

// ============================================
// PHOTOREAL EARTH SCENE
// ============================================
// To-scale Earth (radius 5 in scene units = 6371 km IRL). Built so
// Starlink satellites in phase 2 can sit at the correct altitude:
//   Shell 1 (550 km)  → orbit radius ≈ 5.43
//   Shell 2 (570 km)  → orbit radius ≈ 5.45
//   Shell 3 (340 km)  → orbit radius ≈ 5.27
//
// Textures load with a multi-CDN fallback chain. If ALL CDNs fail
// (offline, blocked, every endpoint down), we fall back to a
// procedural shader Earth so the user NEVER sees a broken page.

const EARTH_RADIUS = 5
// Thin limb-glow shell — a hair larger than Earth so its back-faces
// form a crescent of light right at the silhouette edge. Sun-gated in
// the shader so it only lights the sun-facing limb (the "sunrise
// pouring around the edge" look), not a full contrast-killing halo.
const LIMB_GLOW_RADIUS = EARTH_RADIUS * 1.035
// Far backdrop sphere for the procedural Milky Way + nebula. Sits well
// beyond the GEO ring (~33) and the star shell (~350) but inside the
// camera far plane so it's always the painted-on sky behind everything.
const GALAXY_RADIUS = 480

// Textures are committed to the repo at public/textures/planets/
// and served same-origin. CRITICAL: paths must be prefixed with
// import.meta.env.BASE_URL, NOT a root-absolute "/textures/...".
// Vite rewrites bundled imports + HTML tags for the deploy base
// path (/musk-constellation/ on GitHub Pages) but does NOT rewrite
// string literals — so a hardcoded "/textures/..." 404s on Pages
// and only works on a root-deployed host. BASE_URL ends in "/", so
// the suffix has no leading slash.
const BASE = import.meta.env.BASE_URL
type TextureKey = 'day' | 'normal' | 'night' | 'specular'
const TEXTURES: Record<TextureKey, string> = {
  // 8K Solar System Scope daymap — bright, vivid, cloud-FREE, 4× the
  // resolution of the old 2K Blue Marble (which was dark and had
  // clouds baked in that read as shading). Flat daytime albedo, no
  // terminator baked in — the day/night shading is all done live in
  // the shader from the real sun position.
  day: `${BASE}textures/planets/earth_day_8k.jpg`,
  normal: `${BASE}textures/planets/earth_normal_2048.jpg`,
  // 8K night map — crisp city lights that hold up when zoomed in.
  night: `${BASE}textures/planets/earth_night_8k.jpg`,
  // Water mask — white = ocean, black = land. Drives the ocean-only
  // specular sheen on the daylit hemisphere.
  specular: `${BASE}textures/planets/earth_specular_2048.jpg`,
}

// Linear-data textures (no sRGB decode). Normal map carries vectors,
// specular map is a mask — both are data, not color.
const LINEAR_TEXTURES = new Set<TextureKey>(['normal', 'specular'])

// Load one texture with the right color-space config baked in at
// load time so we never have to mutate the prop ref later. Returns
// null on failure so the calling code can fall back gracefully —
// in practice with same-origin assets this should never fire.
async function tryLoadTexture(key: TextureKey): Promise<THREE.Texture | null> {
  const loader = new THREE.TextureLoader()
  try {
    const tex = await loader.loadAsync(TEXTURES[key])
    tex.anisotropy = 16
    tex.colorSpace = LINEAR_TEXTURES.has(key) ? THREE.NoColorSpace : THREE.SRGBColorSpace
    tex.needsUpdate = true
    return tex
  } catch (err) {
    console.warn(`[EarthScene] ${key} texture failed to load:`, err)
    return null
  }
}

// ============================================
// Limb-glow shader — thin sun-gated rim at the planet's edge
// ============================================
// Back-side rim on a shell a hair larger than Earth. A tight fresnel
// term lights only the silhouette edge; a sun-direction gate then
// restricts that to the sun-facing limb, so from the night side you
// see a thin crescent of light "pouring around" the planet (the
// Apple-Maps terminator bleed) rather than a full halo.
const RIM_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
  // World-space normal (see SURFACE_VERT) so the lit crescent tracks
  // the real sub-solar point, not the camera.
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`

const RIM_FRAG = /* glsl */ `
uniform vec3 uSunDir;
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  // Tight fresnel → glow concentrates in a thin band at the very edge.
  float fres = pow(1.0 - max(0.0, dot(N, V)), 3.2);
  // Sun gate: only the limb that faces the sun lights up, with a soft
  // ramp through the terminator so it's a crescent, not a ring.
  float sun = dot(N, normalize(uSunDir));
  float gate = smoothstep(-0.15, 0.55, sun);
  // Warm white where the sun is strong (the bright sunrise bleed),
  // cooling to thin blue as it wraps toward the terminator.
  vec3 warm = vec3(1.00, 0.90, 0.72);
  vec3 cool = vec3(0.42, 0.64, 1.05);
  vec3 col = mix(cool, warm, smoothstep(0.0, 0.7, sun));
  gl_FragColor = vec4(col, fres * gate * 0.9);
}
`

// ============================================
// Galaxy backdrop shader — procedural Milky Way + one clean nebula
// ============================================
// Painted on a huge inverted sphere so it's the fixed sky behind the
// whole scene. A tilted Gaussian band gives the Milky Way; a single
// fbm-masked region gives one tasteful nebula off to one side. Kept
// dim (peaks well under the satellites' brightness) so it adds depth
// without competing with the dots. No texture download — all procedural.
const GALAXY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  // World-space sky direction (sphere is centred on the origin), so the
  // backdrop stays fixed in space as the camera orbits.
  vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const GALAXY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec3 dir = normalize(vDir);
  // Deep-space base — a hair above pure black so it never banishes
  // contrast but still reads as space.
  vec3 col = vec3(0.011, 0.013, 0.026);

  // Milky Way: bright haze concentrated along a tilted great circle.
  vec3 bandN = normalize(vec3(0.30, 1.0, 0.20));
  float d = dot(dir, bandN);
  float band = exp(-d * d * 6.0);
  float clouds = fbm(dir * 5.0 + 7.0);
  clouds = clouds * clouds;
  float mw = band * (0.45 + 0.55 * clouds);
  vec3 mwCol = mix(vec3(0.26, 0.29, 0.42), vec3(0.55, 0.49, 0.42), clouds);
  col += mwCol * mw * 0.38;

  // One clean nebula, masked to a single background region so it reads
  // as "off in the distance" rather than smeared across the whole sky.
  float nb = fbm(dir * 2.4 - 19.0);
  float region = smoothstep(0.05, 0.92, dot(dir, normalize(vec3(-0.65, 0.15, 0.74))));
  float neb = smoothstep(0.40, 0.95, nb) * region;
  vec3 nebCol = mix(vec3(0.12, 0.30, 0.52), vec3(0.40, 0.14, 0.46), smoothstep(0.5, 1.0, nb));
  col += nebCol * neb * 0.32;

  gl_FragColor = vec4(col, 1.0);
}
`

// ============================================
// Photoreal Earth surface shader — drives the textured sphere
// when all real-image maps load. Custom shader (rather than
// meshStandardMaterial) so we can:
//   - Apply ocean-only specular highlights via the water mask
//   - Smoothly cross-fade day → night at the terminator instead
//     of the abrupt cut meshStandardMaterial.emissiveMap produces
//   - Mix a faint blue Rayleigh-style veil into the limb so the
//     surface itself appears to be lit through atmosphere
// ============================================
const SURFACE_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vObjectNormal;
varying vec2 vUv;
void main() {
  // WORLD-space normal (mat3(modelMatrix) * normal), NOT the built-in
  // normalMatrix — that transforms to VIEW space, which rotates with
  // the camera. Our sun direction (uSunDir) is in world space, so the
  // normal must be too; otherwise the lit hemisphere follows the
  // camera instead of staying fixed to the real sub-solar point.
  vNormal = normalize(mat3(modelMatrix) * normal);
  vObjectNormal = normal;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`

const SURFACE_FRAG = /* glsl */ `
uniform sampler2D uDayMap;
uniform sampler2D uNightMap;
uniform sampler2D uNormalMap;
uniform sampler2D uSpecularMap;
uniform vec3 uSunDir;
uniform float uHasNormal;
uniform float uHasNight;
uniform float uHasSpecular;
uniform float uNormalStrength;
uniform float uNightIntensity;
uniform float uAtmosphereStrength;
uniform float uTime;
uniform float uWaveStrength;

varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vObjectNormal;
varying vec2 vUv;

// Approximate world-space normal perturbation from a tangent-space
// normal map without an explicit tangent attribute. Cheap and good
// enough for a sphere — relief shows up nicely on continents.
vec3 perturbNormal(vec3 N, vec3 V, vec2 uv) {
  vec2 st0 = dFdx(uv);
  vec2 st1 = dFdy(uv);
  // At the equirectangular wrap seam (u jumps 1→0) and at the poles,
  // the uv derivatives explode or collapse to ~0, which makes the
  // tangent basis normalize() a near-zero vector → NaN normals and a
  // flickering line down the date-line. Bail to the geometric normal
  // when the derivative magnitude is degenerate.
  if (length(st0) + length(st1) > 0.2 || length(st0) + length(st1) < 1e-6) {
    return N;
  }
  vec3 q0 = dFdx(V);
  vec3 q1 = dFdy(V);
  vec3 S = normalize(q0 * st1.t - q1 * st0.t);
  vec3 T = normalize(-q0 * st1.s + q1 * st0.s);
  mat3 tsn = mat3(S, T, N);
  vec3 mapN = texture2D(uNormalMap, uv).xyz * 2.0 - 1.0;
  mapN.xy *= uNormalStrength;
  return normalize(tsn * mapN);
}

// --- Smooth gradient (Perlin-style) noise for the ocean. Quintic
// interpolation + domain warping give organic, FLOWING water rather
// than the blocky grid look of value noise — key to it reading as a
// high-quality moving sea instead of pixelated randomness.
vec2 hash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453123);
}
float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0); // quintic fade
  float a = dot(hash22(i + vec2(0.0, 0.0)) * 2.0 - 1.0, f - vec2(0.0, 0.0));
  float b = dot(hash22(i + vec2(1.0, 0.0)) * 2.0 - 1.0, f - vec2(1.0, 0.0));
  float c = dot(hash22(i + vec2(0.0, 1.0)) * 2.0 - 1.0, f - vec2(0.0, 1.0));
  float d = dot(hash22(i + vec2(1.0, 1.0)) * 2.0 - 1.0, f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm2(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * gnoise(p); p *= 2.0; a *= 0.5; }
  return v;
}
// Whole-ocean current field: domain-warped fbm that scrolls with time,
// so the entire sea drifts in visible swirling currents. Returns ~0..1.
float oceanFlow(vec2 uv, float t) {
  // Strong warp → the flow curls into swirls/eddies rather than blobs.
  vec2 warp = vec2(gnoise(uv * 2.0 + vec2(0.0, t * 0.020)),
                   gnoise(uv * 2.0 + vec2(5.2 - t * 0.015, 1.3)));
  float f = fbm2(uv * 3.4 + warp * 1.6 + vec2(t * 0.032, t * 0.014));
  return f * 0.5 + 0.5;
}

void main() {
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 sunDir = normalize(uSunDir);

  // GEOMETRIC sphere normal — the reliable one. ALL macro sun
  // lighting is driven from this, so the planet's illumination is
  // always physically correct: the sun-facing hemisphere is lit, the
  // far side is dark, no matter what the normal map does.
  vec3 Ngeo = normalize(vNormal);

  // Normal-mapped normal — adds fine surface relief (mountain ranges
  // catching grazing light). Used ONLY for a gentle, clamped relief
  // shade + the specular sparkle — NEVER as the primary light normal.
  // The screen-space tangent basis (dFdx/dFdy) is too noisy/wrong-
  // handed to drive the main diffuse; doing so was corrupting the
  // continents' normals and turning the land black while the flat-
  // normal-map oceans stayed correctly lit. That was the bug.
  vec3 Nrelief = Ngeo;
  if (uHasNormal > 0.5) {
    Nrelief = perturbNormal(Ngeo, -viewDir, vUv);
  }

  // Primary sun term from the geometric normal.
  float NdotL = dot(Ngeo, sunDir);
  float reliefDot = dot(Nrelief, sunDir);

  vec3 dayColor = texture2D(uDayMap, vUv).rgb;

  // Water mask (white = ocean, black = land). Computed once here and
  // reused by the night-side silhouette + the ocean specular below.
  float waterMask = uHasSpecular > 0.5 ? texture2D(uSpecularMap, vUv).r : 0.0;
  float landMask = 1.0 - waterMask;

  // ============================================
  // DAY/NIGHT — Apple-Maps style. The whole sunlit hemisphere reads
  // as bright, evenly-lit daytime; a smooth band fades to a dark
  // night side glowing with city lights. Sun = REAL sub-solar point,
  // so daytime on the globe = daytime in real life.
  // ============================================
  // termMask: 1 on the day side, 0 on the night side, with a smooth
  // transition band straddling the terminator. This drives the
  // day↔night crossfade so the boundary fades like light casting
  // around the curve of the planet.
  float termMask = smoothstep(-0.18, 0.15, NdotL);

  // ============================================
  // OCEAN — procedural moving water. Replaces the daymap's smooth (and
  // JPEG-blocky) blue seas with a domain-warped, scrolling flow field so
  // the WHOLE ocean drifts like real currents — not just a sparkle in
  // the sun — and an animated sun-glitter rides on top. Computed before
  // the day shading so the moving water flows through into dayLit; runs
  // on lit ocean only (cheap elsewhere).
  // ============================================
  vec3 specularLit = vec3(0.0);
  if (waterMask > 0.02 && termMask > 0.004) {
    vec2 ouv = vUv * vec2(2.0, 1.0); // ~isotropic on the equirect sphere
    float t = uTime;

    // Two scales of moving current: broad swirls + finer striations, so
    // the motion is clearly visible across the whole sea.
    float flowBig = oceanFlow(ouv * 1.7, t);
    float flowFine = fbm2(ouv * 7.5 + vec2(t * 0.05, t * 0.022)) * 0.5 + 0.5;
    float flow = flowBig * 0.7 + flowFine * 0.3;
    vec3 deepCol = vec3(0.008, 0.075, 0.205); // deep open ocean (navy)
    vec3 midCol  = vec3(0.050, 0.255, 0.470); // lit swells / currents
    vec3 oceanCol = mix(deepCol, midCol, smoothstep(0.24, 0.82, flow));
    // Natural latitude tint: teal-warm near the equator, deeper toward
    // the poles — breaks the flat-blue-marble uniformity.
    float lat = abs(vUv.y - 0.5) * 2.0;
    oceanCol *= mix(vec3(1.06, 1.05, 0.97), vec3(0.82, 0.90, 1.06), lat);
    // Keep a hint of the real map so coastlines/shallow seas still read.
    oceanCol = mix(oceanCol, dayColor * vec3(0.58, 0.85, 1.12), 0.16);
    dayColor = mix(dayColor, oceanCol, waterMask);

    // Fine ripples → animated glitter normal (single-octave gradient
    // of a fast-scrolling field), lifted into a sphere tangent basis.
    vec2 rdir = vec2(t * 0.05, t * 0.028);
    float e = 0.0035;
    float rC = gnoise(ouv * 16.0 + rdir);
    float rX = gnoise(ouv * 16.0 + vec2(e, 0.0) * 16.0 + rdir);
    float rY = gnoise(ouv * 16.0 + vec2(0.0, e) * 16.0 + rdir);
    vec2 grad = vec2(rX - rC, rY - rC);
    vec3 upRef = abs(Ngeo.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 Tw = normalize(cross(upRef, Ngeo));
    vec3 Bw = cross(Ngeo, Tw);
    vec3 Nwave = normalize(Ngeo + (Tw * grad.x + Bw * grad.y) * uWaveStrength);
    vec3 halfDir = normalize(sunDir + viewDir);
    // Faint broad sheen + a tight animated sparkle (silvery, clean).
    float broad = pow(max(0.0, dot(Nrelief, halfDir)), 16.0) * 0.09;
    float glint = pow(max(0.0, dot(Nwave, halfDir)), 220.0) * 0.45;
    specularLit = (vec3(0.66, 0.78, 1.00) * broad + vec3(0.95, 0.97, 1.00) * glint)
                  * waterMask * termMask;
  }

  // Day brightness: kept HIGH and fairly FLAT across the day side so
  // entire continents read as lit (not a hot spot at the sub-solar
  // point). 0.88 floor + a gentle gradient toward the sub-solar point.
  float dayBright = 0.88 + 0.12 * smoothstep(0.0, 0.65, NdotL);
  // Subtle relief shading from the bump normal — clamped so terrain
  // never darkens the land much.
  float reliefShade = clamp(1.0 + 0.5 * (reliefDot - NdotL), 0.88, 1.15);
  // Moderate gain — the 8K SSS daymap is already bright + saturated,
  // so it needs far less push than the old dark Blue-Marble texture
  // (which used 3.4×). Light saturation lift only.
  vec3 dayBase = dayColor * dayBright * 1.55 * reliefShade;
  float dayLum = dot(dayBase, vec3(0.299, 0.587, 0.114));
  vec3 dayLit = mix(vec3(dayLum), dayBase, 1.06);

  // Night side: city lights from the emissive map, warm-tinted.
  vec3 nightLit = vec3(0.0);
  if (uHasNight > 0.5) {
    vec3 lightsTex = texture2D(uNightMap, vUv).rgb;
    vec3 cityColor = lightsTex * vec3(1.05, 0.90, 0.58);
    nightLit = cityColor * uNightIntensity;
  }
  // Night-side silhouette — Apple Maps style. Land reads as a dark
  // slate-blue, ocean as near-black, so the CONTINENT OUTLINES are
  // visible on the dark side even before the city lights. Without
  // this the night side was a featureless black void.
  vec3 nightLand  = vec3(0.085, 0.105, 0.150);  // dark slate-blue land
  vec3 nightOcean = vec3(0.015, 0.022, 0.040);  // near-black sea
  vec3 nightBase = mix(nightOcean, nightLand, landMask);

  // Crossfade day → (night base + city lights) across the terminator.
  vec3 color = mix(nightBase + nightLit, dayLit + specularLit, termMask);

  // ============================================
  // ATMOSPHERIC HAZE — Rayleigh-style limb tint
  // Surfaces near the limb are viewed through more atmosphere,
  // so they pick up a faint blue scatter. Modulated by sun light
  // so the night side doesn't fluoresce blue.
  // ============================================
  float fres = pow(1.0 - max(0.0, dot(Ngeo, viewDir)), 2.4);
  // Only haze the lit side — atmospheric scattering needs sunlight.
  float hazeLit = smoothstep(-0.10, 0.40, NdotL);
  vec3 hazeColor = vec3(0.40, 0.62, 1.00);
  color = mix(color, hazeColor, fres * hazeLit * uAtmosphereStrength);

  gl_FragColor = vec4(color, 1.0);
}
`

// ============================================
// Real-time sun direction (sub-solar point, ECEF → scene)
// ============================================
// Where the sun is directly overhead at the current UTC instant.
// Sub-solar longitude: 0° (Greenwich) at 12:00 UTC, sweeping west
// 15°/hour. Latitude (declination) from Earth's axial tilt × the
// day-of-year. Returned in the SAME ECEF→scene frame the satellites
// use — ECEF (x,y,z) → scene (x, z, -y) — so daytime on the globe
// matches daytime in real life and the terminator lands correctly.
function computeSunDirection(now: Date, out: THREE.Vector3): THREE.Vector3 {
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600
  const lonRad = -((utcHours - 12) / 24) * 2 * Math.PI

  const start = Date.UTC(now.getUTCFullYear(), 0, 0)
  const dayOfYear = (now.getTime() - start) / (1000 * 60 * 60 * 24)
  const declRad = (23.44 * Math.PI / 180) * Math.sin(2 * Math.PI * (dayOfYear - 81) / 365)

  const cosLat = Math.cos(declRad)
  const x = cosLat * Math.cos(lonRad)
  const y = cosLat * Math.sin(lonRad)
  const z = Math.sin(declRad)
  return out.set(x, z, -y).normalize()
}

// ============================================
// SUN DRIVER — single source of sun-direction truth
// ============================================
// Renders nothing; runs one useFrame that writes the live real-time
// sub-solar direction into the shared sunDirRef + aims the
// directional light. Always mounted (both view modes) so the
// terminator stays correct even in Map mode where <Earth>
// isn't rendered. Earth's surface shader READS sunDirRef — this is
// the only writer.
function SunDriver({
  sunDirRef,
  sunLightRef,
}: {
  sunDirRef: React.MutableRefObject<THREE.Vector3>
  sunLightRef: React.RefObject<THREE.DirectionalLight | null>
}) {
  useFrame(() => {
    const dir = computeSunDirection(new Date(), sunDirRef.current)
    if (sunLightRef.current) {
      sunLightRef.current.position.copy(dir).multiplyScalar(50)
    }
  })
  return null
}

// ============================================
// LIMB GLOW — thin sun-gated rim of light at the planet's edge
// ============================================
// One back-side shell a hair larger than Earth. The fresnel term lights
// only the silhouette; the sun gate in RIM_FRAG restricts it to the
// sun-facing limb, so from the night side you get a thin crescent of
// light pouring around the edge (Apple-Maps style) without a full halo
// that would wash out satellite contrast.
function LimbGlow({
  sunDirRef,
}: {
  sunDirRef: React.MutableRefObject<THREE.Vector3>
}) {
  const uniforms = useMemo(
    () => ({ uSunDir: { value: new THREE.Vector3(1, 0.25, 0.6).normalize() } }),
    [],
  )
  useFrame(() => {
    uniforms.uSunDir.value.copy(sunDirRef.current)
  })
  return (
    <mesh>
      <sphereGeometry args={[LIMB_GLOW_RADIUS, 96, 96]} />
      <shaderMaterial
        vertexShader={RIM_VERT}
        fragmentShader={RIM_FRAG}
        uniforms={uniforms}
        transparent
        side={THREE.BackSide}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}

// ============================================
// GALAXY — procedural Milky Way + nebula backdrop sphere
// ============================================
// A huge inverted sphere painted by the galaxy shader. Rendered first
// (renderOrder -1, no depth test/write) so it's pure backdrop behind
// every other object; the crisp drei star points draw on top of it.
function Galaxy() {
  return (
    <mesh renderOrder={-1} scale={[GALAXY_RADIUS, GALAXY_RADIUS, GALAXY_RADIUS]}>
      <sphereGeometry args={[1, 48, 48]} />
      <shaderMaterial
        vertexShader={GALAXY_VERT}
        fragmentShader={GALAXY_FRAG}
        side={THREE.BackSide}
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  )
}

// ============================================
// EARTH (textured if loaded, procedural fallback otherwise)
// ============================================
interface LoadedTextures {
  day: THREE.Texture | null
  normal: THREE.Texture | null
  night: THREE.Texture | null
  specular: THREE.Texture | null
}

function Earth({
  textures,
  sunDirRef,
}: {
  textures: LoadedTextures
  sunDirRef: React.MutableRefObject<THREE.Vector3>
}) {
  const earthRef = useRef<THREE.Mesh>(null)
  // Ref to the photoreal material so we can advance the ocean-wave time
  // uniform per-frame without mutating the memoized uniforms object
  // (which the react-hooks immutability lint disallows).
  const matRef = useRef<THREE.ShaderMaterial>(null)

  const hasDayTexture = !!textures.day

  // Uniforms for the photoreal surface shader. Keyed on the
  // textures object so the uniforms (and material) rebuild when
  // textures arrive from disk — cheap, happens once at startup.
  // sunDir is mutated per-frame in useFrame, which is exempt from
  // the react-hooks immutability rule (it's not a tracked hook).
  const surfaceUniforms = useMemo(
    () => ({
      uDayMap: { value: textures.day },
      uNightMap: { value: textures.night },
      uNormalMap: { value: textures.normal },
      uSpecularMap: { value: textures.specular },
      uSunDir: { value: new THREE.Vector3(1, 0.25, 0.6).normalize() },
      uHasNormal: { value: textures.normal ? 1.0 : 0.0 },
      uHasNight: { value: textures.night ? 1.0 : 0.0 },
      uHasSpecular: { value: textures.specular ? 1.0 : 0.0 },
      // Stronger relief than the old meshStandardMaterial setting
      // (was 0.85) — exaggerates mountain ranges so they catch the
      // grazing sun light near the terminator.
      uNormalStrength: { value: 1.2 },
      // City lights — punched up from the old 0.7 emissiveIntensity
      // so the night hemisphere really pops on the dark side.
      uNightIntensity: { value: 1.35 },
      // Limb haze contribution — subtle. Peak ~0.22 at the rim.
      uAtmosphereStrength: { value: 0.22 },
      // Animated ocean: uTime advances the scrolling wave field;
      // uWaveStrength sets how hard the micro-waves tilt the water
      // normal for the sun-glitter.
      uTime: { value: 0 },
      uWaveStrength: { value: 1.2 },
    }),
    [textures],
  )

  // Per-frame: read the shared sun direction (written by SunDriver)
  // into the surface shader uniform. Earth does NOT auto-rotate — the
  // scene is in ECEF, so the Earth is "fixed" and the sun position
  // rotates over time instead. That's also what makes the satellite
  // ECF positions land over the right continents.
  useFrame((_, delta) => {
    surfaceUniforms.uSunDir.value.copy(sunDirRef.current)
    // Advance the ocean wave animation (frame-rate independent) via the
    // material ref so we don't mutate the memoized uniforms object.
    const mat = matRef.current
    if (mat) mat.uniforms.uTime.value += delta
  })

  return (
    <group>
      <mesh ref={earthRef}>
        <sphereGeometry args={[EARTH_RADIUS, 128, 128]} />
        {hasDayTexture ? (
          /* Photoreal path — custom shader for ocean specular, smooth
             terminator, city lights, and a faint blue Rayleigh haze
             near the limb. The `key` is CRITICAL: it differs from the
             loading material below so r3f builds a FRESH ShaderMaterial
             when textures arrive (swapping vertex/fragment props on an
             existing material doesn't recompile the program — that
             caused the old "stuck until toggle" bug). */
          <shaderMaterial
            ref={matRef}
            key="earth-photoreal"
            vertexShader={SURFACE_VERT}
            fragmentShader={SURFACE_FRAG}
            uniforms={surfaceUniforms}
          />
        ) : (
          /* Loading state — a clean flat dark-ocean sphere (no ugly
             procedural continents). Shows the planet silhouette + the
             atmosphere halo immediately; sharpens to the real Earth
             the instant the 8K texture finishes streaming in. */
          <meshBasicMaterial key="earth-loading" color="#0e2038" />
        )}
      </mesh>

      {/* The only edge glow is the thin sun-gated <LimbGlow /> sibling
          in the scene (not here) — the old full blue halo that washed
          out satellite contrast is gone. Clouds were removed too — the
          example cloud texture read as patchy lichen on the surface. */}
    </group>
  )
}

// ============================================
// SCENE — loads textures imperatively + renders
// ============================================
interface EarthSceneProps {
  satellites?: SatelliteEntry[]
  enabledConstellations?: Set<ConstellationKey>
  /**
   * View mode: 'satellite' (default) renders the photoreal textured Earth;
   * 'map' renders a stylized flat political-map style Earth. The
   * atmosphere halo, satellite cloud, and starfield stay visible in
   * both modes — only the Earth sphere swaps.
   */
  viewMode?: EarthViewMode
  /** Selected sats to draw orbit trails for (in selection order). */
  selectedSatellites?: SatelliteEntry[]
}

export default function EarthScene({
  satellites,
  enabledConstellations,
  viewMode = 'satellite',
  selectedSatellites,
}: EarthSceneProps) {
  const [textures, setTextures] = useState<LoadedTextures>({
    day: null,
    normal: null,
    night: null,
    specular: null,
  })
  const [loadStatus, setLoadStatus] = useState<'loading' | 'done' | 'fallback'>('loading')

  // Shared sun-direction state. Initialized to a sensible angle so
  // the first frame isn't dead-dark; the useFrame in <Earth /> then
  // updates it from real UTC each render tick.
  const sunDirRef = useRef(new THREE.Vector3(1, 0.25, 0.6).normalize())
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null)

  // Ref to the OrbitControls instance so the keyboard handler can
  // manipulate controls.target + the camera and call controls.update().
  const controlsRef = useRef<OrbitControlsImpl>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [day, normal, night, specular] = await Promise.all([
        tryLoadTexture('day'),
        tryLoadTexture('normal'),
        tryLoadTexture('night'),
        tryLoadTexture('specular'),
      ])
      if (cancelled) return
      setTextures({ day, normal, night, specular })
      setLoadStatus(day ? 'done' : 'fallback')
      if (!day) {
        console.warn('[EarthScene] Earth day texture failed to load')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <Canvas
        camera={{ position: [0, 2, 21], fov: 42 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.outputColorSpace = THREE.SRGBColorSpace
        }}
      >
        <color attach="background" args={['#020208']} />

        {/* Procedural Milky Way + nebula backdrop — dim, fixed in space,
            behind everything. Adds depth without competing with sats. */}
        <Galaxy />

        <ambientLight intensity={0.12} color="#7080a0" />
        {/* Sun — positioned per-frame by SunDriver, which keeps it
            aligned to the camera so the visible hemisphere stays lit. */}
        <directionalLight
          ref={sunLightRef}
          intensity={2.4}
          color="#fff7d6"
        />
        {/* Faint rim-fill so the night hemisphere isn't dead black. */}
        <directionalLight position={[-18, -4, -10]} intensity={0.14} color="#445080" />

        {/* Sun driver is always mounted so the day/night terminator
            stays live in BOTH view modes. Earth's surface shader
            (Satellite) and MapEarth (unshaded flat map) swap
            underneath. The full blue atmosphere halo was removed (it
            washed out satellite contrast); LimbGlow restores just a
            thin sun-gated crescent of light at the edge. */}
        <SunDriver sunDirRef={sunDirRef} sunLightRef={sunLightRef} />
        <LimbGlow sunDirRef={sunDirRef} />

        {viewMode === 'satellite' ? (
          <Suspense fallback={null}>
            <Earth
              textures={textures}
              sunDirRef={sunDirRef}
            />
          </Suspense>
        ) : (
          <Suspense fallback={null}>
            <MapEarth />
          </Suspense>
        )}

        {satellites && satellites.length > 0 && (
          <SatelliteCloud
            satellites={satellites}
            enabledConstellations={enabledConstellations}
          />
        )}

        {/* Orbit trails for selected sats — flight paths showing each
            one's full last orbit, fading from tail to current position. */}
        {selectedSatellites && selectedSatellites.length > 0 && (
          <OrbitTrails satellites={selectedSatellites} />
        )}

        {/* Place-name labels (continents / oceans / cities) with
            zoom level-of-detail + back-side occlusion. Geographic, so
            shown in both Satellite and Map modes. */}
        <GlobeLabels />

        {/* Crisp star points sprinkled all over, drawn on top of the
            galaxy haze. More of them + a touch of color so the sky feels
            alive, but small (factor 4) so they never read as satellites. */}
        <DreiStars
          radius={350}
          depth={60}
          count={9000}
          factor={4}
          saturation={0.25}
          fade
          speed={0.12}
        />

        {/* maxDistance is far enough to pull back and frame the
            geostationary ring (~33 scene units out) when the GEO
            operators are toggled on; the default view still opens at
            distance 21. */}
        <OrbitControls
          ref={controlsRef}
          enableDamping
          dampingFactor={0.06}
          minDistance={6}
          maxDistance={92}
          rotateSpeed={0.4}
          zoomSpeed={0.6}
          enablePan={false}
        />

        {/* WASD/QE keyboard camera controls — orbits + zooms + pans the
            camera around controls.target each frame. Mirrors the
            constellation view; composes with the OrbitControls damping
            above (both only touch camera.position + controls.target). */}
        <KeyboardCameraControls controlsRef={controlsRef} />
      </Canvas>

      {loadStatus === 'fallback' && (
        <div className="earth-fallback-note">
          Earth textures didn’t load — check your connection and reload.
        </div>
      )}
    </>
  )
}
