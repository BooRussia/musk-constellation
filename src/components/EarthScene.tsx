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
import Borders from './Borders'
import Graticule from './Graticule'
import LaunchSites from './LaunchSites'
import DetailTiles from './DetailTiles'
import ISSTracker, { type ISSTelemetry } from './ISSTracker'
import ISSOrbitPath from './ISSOrbitPath'
import FollowController from './FollowController'
import HomeController from './HomeController'
import LaunchFocusController from './LaunchFocusController'
import ActiveLaunchPad from './ActiveLaunchPad'
import LaunchCone from './LaunchCone'
import LaunchReplay, { type ReplayControl } from './LaunchReplay'
import type { PastLaunch } from '../lib/pastLaunches'
import type { SatelliteEntry, ConstellationKey, TrackedObject } from '../lib/tle'
import { getMapStyle } from '../data/mapStyles'
import type { TileProvider } from '../lib/tiles'

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
    // Wrap horizontally so sampling across the ±180° meridian blends
    // instead of clamping to the edge column — avoids a hard seam down
    // the Pacific where the equirectangular map wraps.
    tex.wrapS = THREE.RepeatWrapping
    tex.colorSpace = LINEAR_TEXTURES.has(key) ? THREE.NoColorSpace : THREE.SRGBColorSpace
    tex.needsUpdate = true
    return tex
  } catch (err) {
    console.warn(`[EarthScene] ${key} texture failed to load:`, err)
    return null
  }
}

// Load an arbitrary color (sRGB) equirectangular map by URL — used for
// the swappable day/albedo map so the Map-style dropdown can point at any
// image dropped into src/assets/map-styles/.
async function loadColorTexture(url: string): Promise<THREE.Texture | null> {
  const loader = new THREE.TextureLoader()
  try {
    const tex = await loader.loadAsync(url)
    tex.anisotropy = 16
    tex.wrapS = THREE.RepeatWrapping
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    return tex
  } catch (err) {
    console.warn('[EarthScene] map-style texture failed to load:', url, err)
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
uniform float uFullLit;
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  // Tight fresnel → glow concentrates in a thin band at the very edge.
  float fres = pow(1.0 - max(0.0, dot(N, V)), 3.2);
  // Sun gate: only the limb that faces the sun lights up, with a soft
  // ramp through the terminator so it's a crescent, not a ring. In
  // full-sun mode the gate opens all the way around for a full rim.
  float sun = dot(N, normalize(uSunDir));
  float gate = mix(smoothstep(-0.15, 0.55, sun), 1.0, uFullLit);
  // Warm white where the sun is strong (the bright sunrise bleed),
  // cooling to thin blue as it wraps toward the terminator.
  vec3 warm = vec3(1.00, 0.90, 0.72);
  vec3 cool = vec3(0.42, 0.64, 1.05);
  vec3 sunCol = mix(cool, warm, smoothstep(0.0, 0.7, sun));
  // Full-sun: a uniform cool atmospheric rim all the way around.
  vec3 col = mix(sunCol, vec3(0.50, 0.68, 1.05), uFullLit);
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
  // Deep space — near-black. The Milky Way is rendered as actual STARS
  // (a dense band of points, see MilkyWayStars), NOT painted gas clouds.
  // The skydome only adds a very faint, smooth luminous floor along the
  // galactic plane so the band isn't dead black between the stars —
  // no cloud structure, no dust lanes, no nebula.
  vec3 col = vec3(0.010, 0.012, 0.024);
  vec3 bandN = normalize(vec3(0.32, 1.0, 0.22));
  float d = dot(dir, bandN);
  float band = exp(-d * d * 7.0);
  col += vec3(0.05, 0.06, 0.09) * band * 0.32;
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
uniform float uStylized;
uniform float uAurora;
uniform float uStyleBright;
uniform float uFullLit;

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

// --- 3D value noise for the ocean, sampled on the unit SPHERE DIRECTION
// (not the equirect uv). Sampling in 3D on the sphere is seam-free at the
// ±180° meridian AND distortion-free at the poles — the uv-based version
// tore a visible seam down the Pacific where the texture wraps. Quintic
// interpolation + domain warping keep it smooth and flowing, not blocky.
float h13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0); // quintic fade
  return mix(mix(mix(h13(i + vec3(0,0,0)), h13(i + vec3(1,0,0)), f.x),
                 mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), f.x),
                 mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * vnoise3(p); p *= 2.0; a *= 0.5; }
  return v;
}
// Whole-ocean current field: domain-warped fbm over the sphere direction,
// drifting with time. Returns ~0..1.
float oceanFlow3(vec3 sp, float t) {
  vec3 warp = vec3(vnoise3(sp * 2.0 + vec3(0.0, t * 0.020, 0.0)),
                   vnoise3(sp * 2.0 + vec3(5.2, t * 0.015, 1.3)),
                   vnoise3(sp * 2.0 + vec3(1.7, 2.9, t * 0.018))) - 0.5;
  return fbm3(sp * 3.2 + warp * 1.5 + vec3(t * 0.022, 0.0, t * 0.014));
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
  // Day/night terminator — or a flat fully-lit planet when uFullLit is
  // on (the "Day cycle off" toggle): no cast shadow, illuminated all the
  // way around.
  float termMask = mix(smoothstep(-0.18, 0.15, NdotL), 1.0, uFullLit);
  // Lighting factor used for the day brightness gradient + relief: the
  // real sun angle normally, or fully lit (1.0) in full-sun mode.
  float litN = mix(NdotL, 1.0, uFullLit);

  // ============================================
  // OCEAN — procedural moving water. Replaces the daymap's smooth (and
  // JPEG-blocky) blue seas with a domain-warped, scrolling flow field so
  // the WHOLE ocean drifts like real currents — not just a sparkle in
  // the sun — and an animated sun-glitter rides on top. Computed before
  // the day shading so the moving water flows through into dayLit; runs
  // on lit ocean only (cheap elsewhere).
  // ============================================
  vec3 specularLit = vec3(0.0);
  if (uStylized < 0.5 && waterMask > 0.02 && termMask > 0.004) {
    vec3 sp = Ngeo; // unit sphere direction — seam-free, pole-free sample
    float t = uTime;

    // Two scales of moving current: broad swirls + finer striations, so
    // the motion is clearly visible across the whole sea.
    float flowBig = oceanFlow3(sp * 1.6, t);
    float flowFine = fbm3(sp * 6.0 + vec3(t * 0.03, 0.0, t * 0.018));
    float flow = clamp(flowBig * 0.72 + flowFine * 0.45, 0.0, 1.0);
    vec3 deepCol = vec3(0.008, 0.075, 0.205); // deep open ocean (navy)
    vec3 midCol  = vec3(0.050, 0.255, 0.470); // lit swells / currents
    vec3 oceanCol = mix(deepCol, midCol, smoothstep(0.20, 0.78, flow));
    // Natural latitude tint: teal-warm near the equator, deeper toward
    // the poles — breaks the flat-blue-marble uniformity. abs(Ngeo.y) is
    // the sine of latitude (seam-free, unlike vUv.y at the poles).
    float lat = abs(Ngeo.y);
    oceanCol *= mix(vec3(1.06, 1.05, 0.97), vec3(0.82, 0.90, 1.06), lat);
    // Keep a hint of the real map so coastlines/shallow seas still read.
    oceanCol = mix(oceanCol, dayColor * vec3(0.58, 0.85, 1.12), 0.16);
    dayColor = mix(dayColor, oceanCol, waterMask);

    // Fine ripples → animated glitter normal. Finite-difference gradient
    // of a fast-scrolling 3D field along the sphere tangent basis (also
    // seam-free since it samples in 3D, not uv).
    vec3 upRef = abs(Ngeo.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 Tw = normalize(cross(upRef, Ngeo));
    vec3 Bw = cross(Ngeo, Tw);
    vec3 roff = vec3(t * 0.05, -t * 0.03, t * 0.04);
    float e = 0.006;
    float rC = vnoise3(sp * 22.0 + roff);
    float rT = vnoise3((sp + Tw * e) * 22.0 + roff);
    float rB = vnoise3((sp + Bw * e) * 22.0 + roff);
    vec2 grad = vec2(rT - rC, rB - rC);
    vec3 Nwave = normalize(Ngeo + (Tw * grad.x + Bw * grad.y) * uWaveStrength * 1.6);
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
  float dayBright = 0.88 + 0.12 * smoothstep(0.0, 0.65, litN);
  // Subtle relief shading from the bump normal — clamped so terrain
  // never darkens the land much. Flattened to 1.0 in full-sun mode so
  // the planet is evenly lit with no directional shading.
  float reliefShade = clamp(1.0 + 0.5 * (reliefDot - NdotL), 0.88, 1.15);
  reliefShade = mix(reliefShade, 1.0, uFullLit);
  // Moderate gain — the 8K SSS daymap is already bright + saturated,
  // so it needs far less push than the old dark Blue-Marble texture
  // (which used 3.4×). Light saturation lift only.
  vec3 dayBase = dayColor * dayBright * 1.55 * reliefShade;
  float dayLum = dot(dayBase, vec3(0.299, 0.587, 0.114));
  vec3 dayLit = mix(vec3(dayLum), dayBase, 1.06);

  // Night side: city lights from the emissive map, warm-tinted. Skipped
  // for stylized maps (the Earth city map won't match their coastlines).
  vec3 nightLit = vec3(0.0);
  if (uHasNight > 0.5 && uStylized < 0.5) {
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

  // Final surface color. Stylized maps render faithfully — the raw
  // texture lit only by the real-time day/night terminator (no
  // procedural ocean, no Earth city lights). The photoreal pipeline
  // crossfades day → night silhouette + city lights.
  vec3 color;
  if (uStylized > 0.5) {
    // Day side — brightened per-style so darker uploaded maps read
    // clearly. ACES tonemapping (set on the renderer) rolls off any
    // resulting highlights so vivid maps don't blow out.
    vec3 sDay = dayColor * uStyleBright;
    // Night-side TRACING — the premium night look, standard on EVERY
    // map: instead of fading to black, the map stays readable as a dim
    // silhouette and the brightest features (cities/land) glow like
    // night lights.
    float slum = dot(dayColor, vec3(0.299, 0.587, 0.114));
    vec3 sNight = dayColor * 0.34 + vec3(0.006, 0.012, 0.028);
    sNight += dayColor * smoothstep(0.46, 0.86, slum) * 1.15;
    color = mix(sNight, sDay, termMask);
  } else {
    color = mix(nightBase + nightLit, dayLit + specularLit, termMask);
  }

  // Aurora glow — for aurora maps, make the polar green/magenta paint
  // EMIT light so it reads as luminous, 3D aurora (glowing even on the
  // night side) rather than a flat painted band. Gated to high latitudes
  // + vivid, bright green/magenta so ordinary land/sea is untouched.
  if (uAurora > 0.5) {
    float lat = abs(Ngeo.y);                 // 0 equator → 1 pole
    float polar = smoothstep(0.42, 0.78, lat);
    float green = dayColor.g - max(dayColor.r, dayColor.b);
    float magenta = min(dayColor.r, dayColor.b) - dayColor.g;
    float aur = max(green, magenta);
    float bright = max(max(dayColor.r, dayColor.g), dayColor.b);
    float glow = smoothstep(0.06, 0.22, aur) * polar * smoothstep(0.30, 0.60, bright);
    // Gentle shimmer so the curtains feel alive.
    float shimmer = 0.82 + 0.18 * sin(uTime * 1.6 + Ngeo.x * 9.0 + Ngeo.z * 7.0);
    color += dayColor * glow * 1.8 * shimmer;
  }

  // ============================================
  // ATMOSPHERIC HAZE — Rayleigh-style limb tint
  // Surfaces near the limb are viewed through more atmosphere,
  // so they pick up a faint blue scatter. Modulated by sun light
  // so the night side doesn't fluoresce blue.
  // ============================================
  float fres = pow(1.0 - max(0.0, dot(Ngeo, viewDir)), 2.4);
  // Only haze the lit side — atmospheric scattering needs sunlight.
  // Full-sun mode hazes the whole limb so the glow wraps the planet.
  float hazeLit = mix(smoothstep(-0.10, 0.40, NdotL), 1.0, uFullLit);
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
  simTimeRef,
}: {
  sunDirRef: React.MutableRefObject<THREE.Vector3>
  sunLightRef: React.RefObject<THREE.DirectionalLight | null>
  /** When non-null, the sun is computed for this timestamp (ms) instead of
   *  now — used by launch replays to light the scene at the launch time. */
  simTimeRef?: React.MutableRefObject<number | null>
}) {
  useFrame(() => {
    const sim = simTimeRef?.current
    const dir = computeSunDirection(sim != null ? new Date(sim) : new Date(), sunDirRef.current)
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
  fullLit = false,
}: {
  sunDirRef: React.MutableRefObject<THREE.Vector3>
  /** True = full rim all the way around (full-sun mode). */
  fullLit?: boolean
}) {
  const uniforms = useMemo(
    () => ({
      uSunDir: { value: new THREE.Vector3(1, 0.25, 0.6).normalize() },
      uFullLit: { value: fullLit ? 1 : 0 },
    }),
    [fullLit],
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
// GALAXY — deep-space backdrop sphere (faint galactic-plane floor)
// ============================================
// A huge inverted sphere painted by the galaxy shader. Rendered first
// (renderOrder -2, no depth test/write) so it's pure backdrop behind
// every other object; the star points (MilkyWayStars + drei) draw on
// top of it.
function Galaxy() {
  return (
    <mesh renderOrder={-2} scale={[GALAXY_RADIUS, GALAXY_RADIUS, GALAXY_RADIUS]}>
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
// MILKY WAY STARS — the galaxy as actual star points, not clouds
// ============================================
// A custom Points cloud whose stars are heavily concentrated along the
// galactic plane (and brighter/denser toward the galactic centre), so
// the Milky Way reads as a dense river of stars — the real thing —
// instead of painted gas. A uniform fraction is sprinkled everywhere
// else for the general star field.
const STAR_VERT = /* glsl */ `
attribute float size;
attribute vec3 color;
varying vec3 vColor;
void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // Perspective size attenuation, clamped so distant stars stay visible.
  gl_PointSize = max(1.0, size * (320.0 / -mv.z));
  gl_Position = projectionMatrix * mv;
}
`
const STAR_FRAG = /* glsl */ `
precision mediump float;
varying vec3 vColor;
void main() {
  // Round soft point with a tight bright core + gentle halo.
  vec2 uv = gl_PointCoord - 0.5;
  float r = length(uv);
  float a = smoothstep(0.5, 0.0, r);
  a = pow(a, 1.6);
  gl_FragColor = vec4(vColor, a);
}
`

const GALAXY_STARS_RADIUS = 400

// Build the static star buffers ONCE at module load — outside React, so
// the render purity/immutability lint rules don't apply and we can use a
// small mutable PRNG. The field is deterministic (fixed seed), so it
// never changes between renders or reloads.
const GALAXY_STARS = (() => {
  const N = 26000
  const positions = new Float32Array(N * 3)
  const colors = new Float32Array(N * 3)
  const sizes = new Float32Array(N)

  const bandN = new THREE.Vector3(0.32, 1.0, 0.22).normalize()
  // Orthonormal basis spanning the galactic plane.
  const u = new THREE.Vector3(1, 0, 0)
  if (Math.abs(bandN.x) > 0.9) u.set(0, 1, 0)
  u.crossVectors(bandN, u).normalize()
  const v = new THREE.Vector3().crossVectors(bandN, u).normalize()
  const coreDir = new THREE.Vector3(0.74, -0.18, -0.62).normalize()
  const dir = new THREE.Vector3()

  // mulberry32 — deterministic PRNG so the field is fixed.
  let seed = 0x9e3779b9 >>> 0
  const rand = () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  for (let i = 0; i < N; i++) {
    const isBand = rand() < 0.8
    if (isBand) {
      // Offset from the galactic plane with a GAUSSIAN-ish spread (sum of
      // uniforms ≈ normal). A power-law would spike infinitely at 0,
      // collapsing stars onto a razor-thin great-circle "seam"; the bell
      // gives a soft band with finite peak density and no hard line.
      const phi = rand() * Math.PI * 2
      const g = (rand() + rand() + rand() - 1.5) / 1.5 // ~[-1,1], bell
      const theta = g * 0.42 // soft swath, ~±24° at the tails
      const ct = Math.cos(theta), st = Math.sin(theta)
      dir.copy(u).multiplyScalar(Math.cos(phi) * ct)
        .addScaledVector(v, Math.sin(phi) * ct)
        .addScaledVector(bandN, st)
        .normalize()
    } else {
      // Uniform on the sphere.
      const z = rand() * 2 - 1
      const a = rand() * Math.PI * 2
      const rr = Math.sqrt(Math.max(0, 1 - z * z))
      dir.set(rr * Math.cos(a), rr * Math.sin(a), z)
    }
    positions[i * 3] = dir.x * GALAXY_STARS_RADIUS
    positions[i * 3 + 1] = dir.y * GALAXY_STARS_RADIUS
    positions[i * 3 + 2] = dir.z * GALAXY_STARS_RADIUS

    // Colour: mostly cool white, warming toward the galactic centre.
    const core = Math.max(0, dir.dot(coreDir))
    const warm = isBand ? core * 0.5 : 0
    let cr = 0.78 + rand() * 0.22
    let cg = 0.80 + rand() * 0.20
    let cb = 0.90 + rand() * 0.10
    cr = cr * (1 - warm) + 1.0 * warm
    cg = cg * (1 - warm) + 0.85 * warm
    cb = cb * (1 - warm) + 0.62 * warm
    // A few bright stars, the rest faint — gives the band its texture.
    const bright = rand() < 0.06 ? 0.95 + rand() * 0.45 : 0.34 + rand() * 0.42
    colors[i * 3] = cr * bright
    colors[i * 3 + 1] = cg * bright
    colors[i * 3 + 2] = cb * bright
    sizes[i] = rand() < 0.05 ? 2.0 + rand() * 1.8 : 0.7 + rand() * 1.1
  }
  return { positions, colors, sizes }
})()

function MilkyWayStars() {
  const { positions, colors, sizes } = GALAXY_STARS

  return (
    <points renderOrder={-1}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={STAR_VERT}
        fragmentShader={STAR_FRAG}
        transparent
        depthWrite={false}
        depthTest={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
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
  stylized = false,
  aurora = false,
  styleBright = 1.3,
  fullLit = false,
}: {
  textures: LoadedTextures
  sunDirRef: React.MutableRefObject<THREE.Vector3>
  /** True for a dropped-in stylized map → render the texture faithfully
   *  (skip procedural ocean + real-Earth city lights). */
  stylized?: boolean
  /** Make polar green/magenta pixels emit light (glowing aurora). */
  aurora?: boolean
  /** Day-side brightness multiplier for stylized maps. */
  styleBright?: number
  /** True = full sun, no day/night terminator (evenly lit all around). */
  fullLit?: boolean
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
      // 1 = stylized map: show the texture faithfully (no procedural
      // ocean, no real-Earth city lights), lit only by the terminator.
      uStylized: { value: stylized ? 1 : 0 },
      // 1 = make polar green/magenta pixels glow (aurora maps).
      uAurora: { value: aurora ? 1 : 0 },
      // Day-side brightness multiplier for stylized maps.
      uStyleBright: { value: styleBright },
      // 1 = full sun (no day/night terminator), evenly lit all around.
      uFullLit: { value: fullLit ? 1 : 0 },
    }),
    [textures, stylized, aurora, styleBright, fullLit],
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
  /** Selected sats to draw orbit trails for (in selection order). */
  selectedSatellites?: SatelliteEntry[]
  /** Selected map-style id (see src/data/mapStyles.ts) — picks the globe
   *  skin (photoreal / stylized / the procedural Dark Map). */
  mapStyleId?: string
  /** Day/night cycle. false = full sun (no terminator shadow, the
   *  planet is evenly illuminated all the way around). */
  dayCycle?: boolean
  /** Auto-rotate the camera around the globe. */
  autoRotate?: boolean
  /** OrbitControls autoRotateSpeed (degrees/sec-ish; ~2 = default). */
  autoRotateSpeed?: number
  /** Overlay country + US-state boundary lines on the globe. */
  borders?: boolean
  /** Overlay a lon/lat graticule grid on the globe. */
  graticule?: boolean
  /** Mark worldwide rocket launch sites on the ground. */
  launchSites?: boolean
  /** Show place-name labels (continents / oceans / cities). */
  labels?: boolean
  /** Track the ISS live on the globe. */
  iss?: boolean
  /** The ISS tracked object (TLE/satrec), or null until fetched. */
  issSat?: TrackedObject | null
  /** Shared ref the ISS tracker writes live altitude/speed into. */
  issTelemetryRef?: React.MutableRefObject<ISSTelemetry>
  /** Fly the camera to the ISS and follow it through orbit. */
  followISS?: boolean
  /** Fires when the user rotates away while following the ISS. */
  onISSDetached?: () => void
  /** Bump to re-fly to the ISS (recenter). */
  issRecenterSignal?: number
  /** Spin the globe so the next launch's pad faces the camera + stop spin. */
  launchFocusActive?: boolean
  /** The pad to focus on (lat/lon/name). */
  launchPad?: { lat: number; lon: number; name: string } | null
  /** Launch azimuth (deg from N) — draws the trajectory cone when set. */
  launchAzimuth?: number | null
  /** Bump to re-centre on the pad (e.g. re-clicking the launch pill). */
  launchFocusSignal?: number
  /** Bump to reset the camera to the default home framing. */
  homeSignal?: number
  /** Replay a past launch's flight path (null = no replay). */
  replayLaunch?: PastLaunch | null
  /** Shared control ref for the replay clock (play/scrub/speed). */
  replayCtrlRef?: React.MutableRefObject<ReplayControl>
  /** Fires when the user rotates away while chasing the replay vehicle. */
  onReplayDetached?: () => void
  /** Bump to re-fly the chase-cam back onto the replay vehicle. */
  replayRecenterSignal?: number
  /** LIVE launch simulation — same animation as a replay but the clock is
   *  driven by real time. Set while a tracked launch is in flight. */
  liveSimLaunch?: PastLaunch | null
  /** Liftoff time (ms epoch) for the live simulation clock. */
  liveSimNetMs?: number
  /** Hold the live sim behind NET by this many seconds (stream delay). */
  liveStreamDelaySec?: number
  /** Shared control ref for the live-sim clock. */
  liveCtrlRef?: React.MutableRefObject<ReplayControl>
  /** Stream high-res map tiles as you zoom in (Google-Maps-style mosaic). */
  detailTiles?: boolean
  /** Which tile imagery the detail mosaic streams. */
  tileProvider?: TileProvider
}

export default function EarthScene({
  satellites,
  enabledConstellations,
  selectedSatellites,
  mapStyleId,
  dayCycle = true,
  autoRotate = false,
  autoRotateSpeed = 2,
  borders = false,
  graticule = false,
  launchSites = false,
  labels = true,
  iss = false,
  issSat = null,
  issTelemetryRef,
  followISS = false,
  onISSDetached,
  issRecenterSignal = 0,
  launchFocusActive = false,
  launchPad = null,
  launchAzimuth = null,
  launchFocusSignal = 0,
  homeSignal = 0,
  replayLaunch = null,
  replayCtrlRef,
  onReplayDetached,
  replayRecenterSignal = 0,
  liveSimLaunch = null,
  liveSimNetMs,
  liveStreamDelaySec = 0,
  liveCtrlRef,
  detailTiles = false,
  tileProvider = 'satellite',
}: EarthSceneProps) {
  const style = getMapStyle(mapStyleId)
  const fullLit = !dayCycle
  // Live ISS world position, written by ISSTracker, read by FollowController.
  const issPosRef = useRef<THREE.Vector3 | null>(null)
  // Replay vehicle world position, written by LaunchReplay, read by the
  // replay chase-cam FollowController.
  const replayPosRef = useRef<THREE.Vector3 | null>(null)

  // Real-Earth data maps (relief/night/water) load ONCE — they're only
  // used by the photoreal pipeline. The day/albedo map is separate and
  // reloads whenever the selected style changes.
  const [staticMaps, setStaticMaps] = useState<{
    normal: THREE.Texture | null
    night: THREE.Texture | null
    specular: THREE.Texture | null
  }>({ normal: null, night: null, specular: null })
  const [dayMap, setDayMap] = useState<THREE.Texture | null>(null)
  const dayTexRef = useRef<THREE.Texture | null>(null)
  const [loadStatus, setLoadStatus] = useState<'loading' | 'done' | 'fallback'>('loading')

  // Shared sun-direction state. Initialized to a sensible angle so
  // the first frame isn't dead-dark; the useFrame in <Earth /> then
  // updates it from real UTC each render tick.
  const sunDirRef = useRef(new THREE.Vector3(1, 0.25, 0.6).normalize())
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null)
  // Replay overrides the sun time so a past launch is lit at its real time.
  const replaySunTimeRef = useRef<number | null>(null)

  // Ref to the OrbitControls instance so the keyboard handler can
  // manipulate controls.target + the camera and call controls.update().
  const controlsRef = useRef<OrbitControlsImpl>(null)

  // Static real-Earth maps — loaded once.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [normal, night, specular] = await Promise.all([
        tryLoadTexture('normal'),
        tryLoadTexture('night'),
        tryLoadTexture('specular'),
      ])
      if (cancelled) return
      setStaticMaps({ normal, night, specular })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Day/albedo map — reloads whenever the selected style changes. The
  // previous texture is disposed to avoid leaking GPU memory on swaps.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const tex = await loadColorTexture(style.dayUrl)
      if (cancelled) {
        tex?.dispose()
        return
      }
      dayTexRef.current?.dispose()
      dayTexRef.current = tex
      setDayMap(tex)
      setLoadStatus(tex ? 'done' : 'fallback')
      if (!tex) console.warn('[EarthScene] day texture failed:', style.dayUrl)
    })()
    return () => {
      cancelled = true
    }
  }, [style.dayUrl])

  // Stable textures bundle (only changes when a map actually loads/swaps),
  // so the Earth shader's uniforms aren't rebuilt every render.
  const textures = useMemo<LoadedTextures>(
    () => ({
      day: dayMap,
      normal: staticMaps.normal,
      night: staticMaps.night,
      specular: staticMaps.specular,
    }),
    [dayMap, staticMaps],
  )

  return (
    <>
      <Canvas
        camera={{ position: [0, 2, 21], fov: 42, near: 0.05, far: 4000 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.outputColorSpace = THREE.SRGBColorSpace
        }}
      >
        <color attach="background" args={['#020208']} />

        {/* Deep-space backdrop + the Milky Way as a dense band of actual
            star points (not painted clouds), fixed in space behind
            everything. Adds depth without competing with the sats. */}
        <Galaxy />
        <MilkyWayStars />

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
            stays live for every globe skin. The textured Earth shader
            and the procedural MapEarth (unshaded flat dark map) swap
            underneath based on the selected map style. The full blue
            atmosphere halo was removed (it washed out satellite
            contrast); LimbGlow restores just a thin sun-gated crescent
            of light at the edge. */}
        <SunDriver sunDirRef={sunDirRef} sunLightRef={sunLightRef} simTimeRef={replaySunTimeRef} />
        <LimbGlow sunDirRef={sunDirRef} fullLit={fullLit} />

        {style.kind === 'map' ? (
          <Suspense fallback={null}>
            <MapEarth />
          </Suspense>
        ) : (
          <Suspense fallback={null}>
            <Earth
              textures={textures}
              sunDirRef={sunDirRef}
              stylized={style.stylized}
              aurora={style.aurora ?? false}
              styleBright={style.brightness ?? 1.3}
              fullLit={fullLit}
            />
          </Suspense>
        )}

        {/* Google-Maps-style detail mosaic — dormant when zoomed out, then
            streams progressively sharper tiles draped over whatever globe
            skin is active as the camera drops toward the surface. */}
        {detailTiles && <DetailTiles provider={tileProvider} />}

        {satellites && satellites.length > 0 && (
          <SatelliteCloud
            satellites={satellites}
            enabledConstellations={enabledConstellations}
          />
        )}

        {/* International Space Station — live SGP4 marker + Crew Dragon tag. */}
        {iss && issSat && issTelemetryRef && (
          <ISSTracker satrec={issSat.satrec} telemetryRef={issTelemetryRef} posRef={issPosRef} />
        )}

        {/* ISS ground track while following — thicker behind, skinny ahead. */}
        {followISS && issSat && <ISSOrbitPath satrec={issSat.satrec} />}

        {/* Orbit trails for selected sats — flight paths showing each
            one's full last orbit, fading from tail to current position. */}
        {selectedSatellites && selectedSatellites.length > 0 && (
          <OrbitTrails satellites={selectedSatellites} />
        )}

        {/* Place-name labels (continents / oceans / cities) with
            zoom level-of-detail + back-side occlusion. Geographic, so
            shown on any globe skin; toggleable from the Layers menu. */}
        {labels && <GlobeLabels />}

        {/* Country + US-state boundary overlay (lazy-loaded). Sits just
            above the surface so it works on any map skin. */}
        {borders && <Borders />}

        {/* Lon/lat graticule overlay — procedural, works on any map. */}
        {graticule && <Graticule />}

        {/* Worldwide rocket launch-site ground markers. */}
        {launchSites && <LaunchSites />}

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
          minDistance={5.15}
          maxDistance={92}
          rotateSpeed={0.4}
          zoomSpeed={0.6}
          enablePan={false}
          autoRotate={autoRotate && !followISS && !launchFocusActive && !replayLaunch}
          autoRotateSpeed={autoRotateSpeed}
        />

        {/* Chase-cam: flies to and follows the ISS when Trackers→ISS is on. */}
        <FollowController
          controlsRef={controlsRef}
          active={followISS && iss && !!issSat}
          targetRef={issPosRef}
          onDetached={onISSDetached}
          recenterSignal={issRecenterSignal}
        />

        {/* Reset-to-home camera ease. */}
        <HomeController controlsRef={controlsRef} signal={homeSignal} autoRotate={autoRotate} />

        {/* Live launch: spin-to-pad (stops on the site) + the trajectory
            cone. A replay instead chases the vehicle (below), so its
            spin-to-pad is skipped. A bright pulse marks the pad either way. */}
        {launchFocusActive && launchPad && (
          <>
            {/* Pre-liftoff: spin to the pad + show the heading cone. Once the
                live sim or a replay takes over, the chase-cam handles framing. */}
            {!replayLaunch && !liveSimLaunch && (
              <LaunchFocusController
                controlsRef={controlsRef}
                active
                lat={launchPad.lat}
                lon={launchPad.lon}
                signal={launchFocusSignal}
              />
            )}
            <ActiveLaunchPad lat={launchPad.lat} lon={launchPad.lon} name={launchPad.name} />
            {launchAzimuth != null && !liveSimLaunch && (
              <LaunchCone lat={launchPad.lat} lon={launchPad.lon} azimuth={launchAzimuth} />
            )}
          </>
        )}

        {/* Past-launch replay — animated flight path + event markers. */}
        {replayLaunch && replayCtrlRef && (
          <LaunchReplay
            launch={replayLaunch}
            ctrlRef={replayCtrlRef}
            sunTimeRef={replaySunTimeRef}
            posRef={replayPosRef}
          />
        )}

        {/* LIVE launch simulation — same animation, clock driven by real
            time since liftoff. */}
        {liveSimLaunch && liveCtrlRef && (
          <LaunchReplay
            launch={liveSimLaunch}
            ctrlRef={liveCtrlRef}
            sunTimeRef={replaySunTimeRef}
            posRef={replayPosRef}
            liveNetMs={liveSimNetMs}
            liveStreamDelaySec={liveStreamDelaySec}
          />
        )}

        {/* Chase-cam: flies in and follows the vehicle for both a replay and
            a live launch simulation (like the ISS follow). */}
        <FollowController
          controlsRef={controlsRef}
          active={!!replayLaunch || !!liveSimLaunch}
          targetRef={replayPosRef}
          onDetached={onReplayDetached}
          recenterSignal={replayRecenterSignal}
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
