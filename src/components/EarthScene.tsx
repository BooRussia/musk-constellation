import { Suspense, useRef, useMemo, useEffect, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Stars as DreiStars } from '@react-three/drei'
import * as THREE from 'three'
import SatelliteCloud from './SatelliteCloud'
import type { SatelliteEntry, ConstellationKey } from '../lib/tle'

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
const ATMOSPHERE_RADIUS = EARTH_RADIUS * 1.065

// Textures are committed to the repo at public/textures/planets/
// and served same-origin from Netlify. No CDN dependencies, no
// CORS, no version-resolution guesswork — they're sourced from
// three.js's own example suite (raw.githubusercontent.com pull)
// but live in our static assets so we control delivery.
type TextureKey = 'day' | 'normal' | 'night'
const TEXTURES: Record<TextureKey, string> = {
  day: '/textures/planets/earth_atmos_2048.jpg',
  normal: '/textures/planets/earth_normal_2048.jpg',
  night: '/textures/planets/earth_lights_2048.png',
}

// Load one texture with the right color-space config baked in at
// load time so we never have to mutate the prop ref later. Returns
// null on failure so the calling code can fall back gracefully —
// in practice with same-origin assets this should never fire.
async function tryLoadTexture(key: TextureKey): Promise<THREE.Texture | null> {
  const loader = new THREE.TextureLoader()
  try {
    const tex = await loader.loadAsync(TEXTURES[key])
    tex.anisotropy = 8
    // Day and night maps are color data; normal map is linear data.
    tex.colorSpace = key === 'normal' ? THREE.NoColorSpace : THREE.SRGBColorSpace
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
  vNormal = normalize(normalMatrix * normal);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`

const ATMOSPHERE_FRAG = /* glsl */ `
uniform vec3 uSunDir;
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fres = pow(1.0 - dot(vNormal, viewDir), 2.4);
  float sun = max(0.0, dot(vNormal, normalize(uSunDir)));
  vec3 cool = vec3(0.30, 0.62, 1.10);
  vec3 warm = vec3(0.95, 0.78, 0.60);
  vec3 col = mix(cool, warm, sun * 0.55);
  gl_FragColor = vec4(col, fres * 1.35);
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
  vNormal = normalize(normalMatrix * normal);
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
// Real-time sun direction (ECEF)
// ============================================
// Sub-solar point at any UTC time: longitude where the sun is
// directly overhead. At 12:00 UTC sun is at 0° (Greenwich). At
// 00:00 UTC sun is at 180° (Pacific). Latitude approximated via
// axial-tilt × sine of day-of-year.
function computeSunDirection(now: Date): THREE.Vector3 {
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600
  // Sub-solar longitude in radians (positive west since sun
  // "moves" west as Earth spins east).
  const lonRad = -((utcHours - 12) / 24) * 2 * Math.PI

  // Day-of-year approximation for axial-tilt latitude offset.
  const start = Date.UTC(now.getUTCFullYear(), 0, 0)
  const dayOfYear = (now.getTime() - start) / (1000 * 60 * 60 * 24)
  const TILT_DEG = 23.44
  // Solar declination — angle of sub-solar point from equator.
  const declRad = (TILT_DEG * Math.PI / 180) * Math.sin(2 * Math.PI * (dayOfYear - 81) / 365)

  // Lat/Lon to unit vector in geographic frame.
  const cosLat = Math.cos(declRad)
  const x = cosLat * Math.cos(lonRad)
  const y = cosLat * Math.sin(lonRad)
  const z = Math.sin(declRad)
  // Same axis-remap as SatelliteCloud: ECEF (x, y, z) → scene
  // (x, z, -y). Keeps sun, Earth, and satellites coordinated.
  return new THREE.Vector3(x, z, -y).normalize()
}

// ============================================
// EARTH (textured if loaded, procedural fallback otherwise)
// ============================================
interface LoadedTextures {
  day: THREE.Texture | null
  normal: THREE.Texture | null
  night: THREE.Texture | null
}

function Earth({
  textures,
  sunDirRef,
  sunLightRef,
}: {
  textures: LoadedTextures
  sunDirRef: React.MutableRefObject<THREE.Vector3>
  sunLightRef: React.RefObject<THREE.DirectionalLight | null>
}) {
  const earthRef = useRef<THREE.Mesh>(null)

  const hasDayTexture = !!textures.day

  const atmoUniforms = useMemo(
    () => ({ uSunDir: { value: new THREE.Vector3(1, 0.25, 0.6).normalize() } }),
    [],
  )

  const procUniforms = useMemo(
    () => ({ uSunDir: { value: new THREE.Vector3(1, 0.25, 0.6).normalize() } }),
    [],
  )

  // Per-frame: update sun direction from real UTC, point the
  // directional light at Earth from the new sun direction, and
  // propagate the same vector into both shaders. Earth does NOT
  // auto-rotate — the scene is in ECEF, so the Earth is "fixed"
  // and the sun position rotates over time instead. This is also
  // what makes the satellite ECF positions land over the right
  // continents.
  useFrame(() => {
    const sunDir = computeSunDirection(new Date())
    sunDirRef.current.copy(sunDir)
    atmoUniforms.uSunDir.value.copy(sunDir)
    procUniforms.uSunDir.value.copy(sunDir)
    if (sunLightRef.current) {
      // Light far away in the sun direction so it acts directional.
      sunLightRef.current.position.copy(sunDir).multiplyScalar(50)
    }
  })

  return (
    <group>
      <mesh ref={earthRef}>
        <sphereGeometry args={[EARTH_RADIUS, 128, 128]} />
        {hasDayTexture ? (
          <meshStandardMaterial
            map={textures.day!}
            normalMap={textures.normal ?? undefined}
            normalScale={new THREE.Vector2(0.85, 0.85)}
            emissiveMap={textures.night ?? undefined}
            emissive={new THREE.Color('#ffe8b0')}
            emissiveIntensity={textures.night ? 0.7 : 0}
            roughness={0.9}
            metalness={0.0}
          />
        ) : (
          /* Procedural fallback — never fails. */
          <shaderMaterial
            vertexShader={PROC_EARTH_VERT}
            fragmentShader={PROC_EARTH_FRAG}
            uniforms={procUniforms}
          />
        )}
      </mesh>

      {/* Clouds removed — the alpha-mask cloud texture from three.js's
          example suite was a stylized illustration that read as
          patchy lichen against the Blue Marble surface. Phase 4
          could integrate real-time cloud imagery if desired. */}

      {/* Atmosphere always renders — pure shader, no dependencies. */}
      <mesh>
        <sphereGeometry args={[ATMOSPHERE_RADIUS, 96, 96]} />
        <shaderMaterial
          vertexShader={ATMOSPHERE_VERT}
          fragmentShader={ATMOSPHERE_FRAG}
          uniforms={atmoUniforms}
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
// SCENE — loads textures imperatively + renders
// ============================================
interface EarthSceneProps {
  satellites?: SatelliteEntry[]
  enabledConstellations?: Set<ConstellationKey>
}

export default function EarthScene({
  satellites,
  enabledConstellations,
}: EarthSceneProps) {
  const [textures, setTextures] = useState<LoadedTextures>({
    day: null,
    normal: null,
    night: null,
  })
  const [loadStatus, setLoadStatus] = useState<'loading' | 'done' | 'fallback'>('loading')

  // Shared sun-direction state. Initialized to a sensible angle so
  // the first frame isn't dead-dark; the useFrame in <Earth /> then
  // updates it from real UTC each render tick.
  const sunDirRef = useRef(new THREE.Vector3(1, 0.25, 0.6).normalize())
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [day, normal, night] = await Promise.all([
        tryLoadTexture('day'),
        tryLoadTexture('normal'),
        tryLoadTexture('night'),
      ])
      if (cancelled) return
      setTextures({ day, normal, night })
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

        <ambientLight intensity={0.08} color="#7080a0" />
        {/* Sun — positioned per-frame from computeSunDirection so the
            day/night terminator on the Earth matches real UTC time. */}
        <directionalLight
          ref={sunLightRef}
          intensity={2.4}
          color="#fff7d6"
        />
        {/* Faint rim-fill so the night hemisphere isn't dead black. */}
        <directionalLight position={[-18, -4, -10]} intensity={0.12} color="#445080" />

        <Suspense fallback={null}>
          <Earth
            textures={textures}
            sunDirRef={sunDirRef}
            sunLightRef={sunLightRef}
          />
        </Suspense>

        {satellites && satellites.length > 0 && (
          <SatelliteCloud
            satellites={satellites}
            enabledConstellations={enabledConstellations}
          />
        )}

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
          enableDamping
          dampingFactor={0.06}
          minDistance={7}
          maxDistance={48}
          rotateSpeed={0.4}
          zoomSpeed={0.6}
          enablePan={false}
        />
      </Canvas>

      {loadStatus === 'fallback' && (
        <div className="earth-fallback-note">
          Loading photoreal textures from CDN failed — rendering procedural Earth instead.
        </div>
      )}
    </>
  )
}
