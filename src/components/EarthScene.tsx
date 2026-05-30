import { Suspense, useRef, useMemo, useEffect, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Stars as DreiStars } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import SatelliteCloud from './SatelliteCloud'
import MapEarth from './MapEarth'
import KeyboardCameraControls from './KeyboardCameraControls'
import GlobeLabels from './GlobeLabels'
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
// Two-layer atmosphere — an inner halo right at Earth's edge for
// the visible "lit limb" and an outer halo that fades into space
// for the smooth gradient. Together they produce the soft glow
// you see in NASA "Earth from orbit" shots.
const ATMOSPHERE_INNER_RADIUS = EARTH_RADIUS * 1.025
const ATMOSPHERE_OUTER_RADIUS = EARTH_RADIUS * 1.14

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
// Atmosphere shader — fresnel rim glow on a BackSide-rendered
// outer sphere. Warm-tinted on the sun-facing limb, cool blue
// elsewhere. This is the same technique used in every famous
// "Earth from space" tutorial — back-faces compose the halo.
// ============================================
const ATMOSPHERE_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
  // World-space normal (see SURFACE_VERT) so the sun-tinted warm side
  // of the halo aligns with the real sub-solar point, not the camera.
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`

// Inner halo — bright glow right at Earth's lit limb. Tight
// fresnel exponent and clamped output so it never saturates.
const ATMOSPHERE_INNER_FRAG = /* glsl */ `
uniform vec3 uSunDir;
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  // max(0, ...) clamp prevents overshoot when the view points
  // through to the far side of the sphere — without it, alpha
  // pinned to 1.0 across the whole back-face, which read as a
  // hard band in the previous version.
  float ndv = max(0.0, dot(vNormal, viewDir));
  float fres = pow(1.0 - ndv, 1.8);
  float sun = max(0.0, dot(vNormal, normalize(uSunDir)));
  vec3 cool = vec3(0.35, 0.68, 1.10);
  vec3 warm = vec3(0.95, 0.78, 0.60);
  vec3 col = mix(cool, warm, sun * 0.55);
  // Subtle — a real Earth limb glow is a thin faint band, not a
  // bright ring. Cut to 0.30 so it reads as atmosphere, not neon.
  gl_FragColor = vec4(col, fres * 0.30);
}
`

// Outer halo — much wider sphere, soft long-tail fade into space.
// This is the gradient the user wants — it falls off gradually
// from the inner limb all the way to the outer atmosphere edge.
const ATMOSPHERE_OUTER_FRAG = /* glsl */ `
uniform vec3 uSunDir;
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float ndv = max(0.0, dot(vNormal, viewDir));
  // Softer fresnel exponent → wider gradient that smoothly
  // tapers into transparent space.
  float fres = pow(1.0 - ndv, 1.1);
  float sun = max(0.0, dot(vNormal, normalize(uSunDir)));
  vec3 cool = vec3(0.30, 0.55, 1.00);
  vec3 warm = vec3(0.85, 0.65, 0.45);
  vec3 col = mix(cool, warm, sun * 0.4);
  // Whisper-faint outer corona — barely-there scatter that fades
  // into space. 0.12 keeps it from forming a visible second ring.
  gl_FragColor = vec4(col, fres * 0.12);
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

  // ============================================
  // OCEAN SPECULAR — a SOFT, subtle sheen (NOT the old harsh white
  // orb). Wide highlight, low intensity, only on water, only on the
  // lit side. Adds life to the oceans without a blown-out blob.
  // ============================================
  vec3 specularLit = vec3(0.0);
  if (uHasSpecular > 0.5) {
    vec3 halfDir = normalize(sunDir + viewDir);
    // Lower exponent (16) = broad soft sheen; low intensity (0.22).
    float spec = pow(max(0.0, dot(Nrelief, halfDir)), 16.0);
    specularLit = vec3(0.7, 0.8, 1.0) * spec * waterMask * termMask * 0.22;
  }

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
// Procedural Earth shader — fallback when no CDN texture loads.
// Continents emerge from fbm noise, polar caps from latitude,
// city lights from inverse-day shading. Not photoreal, but
// always renders, never fails, no network needed.
// ============================================
const PROC_EARTH_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vPos;
varying vec2 vUv;
void main() {
  // World-space normal so the procedural fallback's lighting also
  // stays fixed to the sun, not the camera.
  vNormal = normalize(mat3(modelMatrix) * normal);
  vPos = position;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const PROC_EARTH_FRAG = /* glsl */ `
uniform vec3 uSunDir;
varying vec3 vNormal;
varying vec3 vPos;
varying vec2 vUv;

// Simplex-ish 3D noise (Inigo Quilez style).
vec3 hash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123) - 0.5;
}
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(dot(hash3(i + vec3(0,0,0)), f - vec3(0,0,0)),
            dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), f.x),
        mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)),
            dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), f.x), f.y),
    mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)),
            dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), f.x),
        mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)),
            dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise3(p);
    p *= 2.0; a *= 0.5;
  }
  return v;
}

void main() {
  // Continent noise.
  vec3 p = vPos * 0.7;
  float n = fbm(p);
  float land = smoothstep(-0.02, 0.08, n);

  // Polar caps via latitude (y-axis = up).
  float lat = abs(normalize(vPos).y);
  float ice = smoothstep(0.75, 0.92, lat);

  vec3 ocean = vec3(0.04, 0.18, 0.42);
  vec3 landCol = mix(vec3(0.20, 0.42, 0.14), vec3(0.55, 0.43, 0.25), fbm(p * 2.5) + 0.3);
  vec3 surface = mix(ocean, landCol, land);
  surface = mix(surface, vec3(0.95, 0.96, 0.98), ice);

  // Sun shading (Lambert).
  float sun = max(0.0, dot(vNormal, normalize(uSunDir)));
  vec3 lit = surface * (0.15 + 0.85 * sun);

  // City lights on the night side — sparse pinpricks.
  float night = 1.0 - sun;
  float lightsNoise = fbm(p * 8.0);
  float lights = step(0.18, lightsNoise) * land * night * night;
  lit += vec3(1.0, 0.85, 0.5) * lights * 0.6;

  gl_FragColor = vec4(lit, 1.0);
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
// terminator + halo stay correct even in Map mode where <Earth>
// isn't rendered. Earth, Atmosphere, and the procedural fallback all
// READ sunDirRef — this is the only writer.
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
// ATMOSPHERE — standalone halo, rendered once in both view modes
// ============================================
// Inner bright halo at the lit limb + outer wide halo that fades
// into space. Reads the shared sunDirRef each frame so the warm
// side aligns with daylight. Rendered as a sibling of Earth/MapEarth
// so the halo is identical regardless of which Earth style is shown.
function Atmosphere({
  sunDirRef,
}: {
  sunDirRef: React.MutableRefObject<THREE.Vector3>
}) {
  const innerUniforms = useMemo(
    () => ({ uSunDir: { value: new THREE.Vector3(1, 0.25, 0.6).normalize() } }),
    [],
  )
  const outerUniforms = useMemo(
    () => ({ uSunDir: { value: new THREE.Vector3(1, 0.25, 0.6).normalize() } }),
    [],
  )
  // Track the shared sun direction every frame so the halo's warm
  // side aligns with the sun even though the Map Earth itself is
  // unshaded.
  useFrame(() => {
    innerUniforms.uSunDir.value.copy(sunDirRef.current)
    outerUniforms.uSunDir.value.copy(sunDirRef.current)
  })

  return (
    <group>
      <mesh>
        <sphereGeometry args={[ATMOSPHERE_INNER_RADIUS, 96, 96]} />
        <shaderMaterial
          vertexShader={ATMOSPHERE_VERT}
          fragmentShader={ATMOSPHERE_INNER_FRAG}
          uniforms={innerUniforms}
          transparent
          side={THREE.BackSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[ATMOSPHERE_OUTER_RADIUS, 96, 96]} />
        <shaderMaterial
          vertexShader={ATMOSPHERE_VERT}
          fragmentShader={ATMOSPHERE_OUTER_FRAG}
          uniforms={outerUniforms}
          transparent
          side={THREE.BackSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
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

  const hasDayTexture = !!textures.day

  const procUniforms = useMemo(
    () => ({ uSunDir: { value: new THREE.Vector3(1, 0.25, 0.6).normalize() } }),
    [],
  )

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
    }),
    [textures],
  )

  // Per-frame: read the shared sun direction (written by SunDriver)
  // into this Earth's surface + procedural shader uniforms. Earth
  // does NOT auto-rotate — the scene is in ECEF, so the Earth is
  // "fixed" and the sun position rotates over time instead. That's
  // also what makes the satellite ECF positions land over the right
  // continents.
  useFrame(() => {
    const sunDir = sunDirRef.current
    procUniforms.uSunDir.value.copy(sunDir)
    surfaceUniforms.uSunDir.value.copy(sunDir)
  })

  return (
    <group>
      <mesh ref={earthRef}>
        <sphereGeometry args={[EARTH_RADIUS, 128, 128]} />
        {hasDayTexture ? (
          /* Photoreal path — custom shader for ocean specular, smooth
             terminator, punched-up city lights, and a faint blue
             Rayleigh haze near the limb. See SURFACE_FRAG above.
             The `key` is CRITICAL: both branches are <shaderMaterial>,
             so without a distinct key r3f reuses the same THREE
             ShaderMaterial instance and just swaps props — but
             changing vertexShader/fragmentShader on an existing
             material does NOT recompile the program. That's why the
             globe stayed procedural after textures finished loading
             until a view-mode toggle force-remounted it. The key
             makes the material a fresh instance when the path flips. */
          <shaderMaterial
            key="earth-photoreal"
            vertexShader={SURFACE_VERT}
            fragmentShader={SURFACE_FRAG}
            uniforms={surfaceUniforms}
          />
        ) : (
          /* Procedural fallback — never fails. */
          <shaderMaterial
            key="earth-procedural"
            vertexShader={PROC_EARTH_VERT}
            fragmentShader={PROC_EARTH_FRAG}
            uniforms={procUniforms}
          />
        )}
      </mesh>

      {/* Atmosphere halo is rendered as a sibling <Atmosphere /> in
          the scene (not here) so it's shared identically between
          Satellite and Map view modes. Clouds were removed — the
          example cloud texture read as patchy lichen against the
          Blue Marble surface. */}
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
}

export default function EarthScene({
  satellites,
  enabledConstellations,
  viewMode = 'satellite',
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
        console.warn('[EarthScene] All texture loads failed — falling back to procedural Earth')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <Canvas
        camera={{ position: [0, 1.5, 14], fov: 42 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.outputColorSpace = THREE.SRGBColorSpace
        }}
      >
        <color attach="background" args={['#020208']} />

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

        {/* Sun driver + atmosphere halo are always mounted, so the
            day/night terminator and limb glow stay live in BOTH view
            modes. Earth's surface shader (Satellite) and MapEarth
            (unshaded flat map) swap underneath. */}
        <SunDriver sunDirRef={sunDirRef} sunLightRef={sunLightRef} />
        <Atmosphere sunDirRef={sunDirRef} />

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

        {/* Place-name labels (continents / oceans / cities) with
            zoom level-of-detail + back-side occlusion. Geographic, so
            shown in both Satellite and Map modes. */}
        <GlobeLabels />

        <DreiStars
          radius={350}
          depth={60}
          count={6000}
          factor={5}
          saturation={0}
          fade
          speed={0.15}
        />

        <OrbitControls
          ref={controlsRef}
          enableDamping
          dampingFactor={0.06}
          minDistance={6}
          maxDistance={48}
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
          Earth textures didn’t load — showing the procedural globe instead.
        </div>
      )}
    </>
  )
}
