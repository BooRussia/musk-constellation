import { Suspense, useRef, useMemo, useEffect } from 'react'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { OrbitControls, Stars as DreiStars } from '@react-three/drei'
import * as THREE from 'three'

// Three.js's TextureLoader defaults to crossOrigin='anonymous'
// so CDN textures upload to the GL texture unit without being
// tainted. No setup needed beyond using TextureLoader directly.

// ============================================
// PHOTOREAL EARTH SCENE
// ============================================
// To-scale Earth (radius 5 in scene units = 6371 km IRL). Built so
// Starlink satellites in phase 2 can sit at the correct altitude:
//   Shell 1 (550 km)  → orbit radius ≈ 5.43
//   Shell 2 (570 km)  → orbit radius ≈ 5.45
//   Shell 3 (340 km)  → orbit radius ≈ 5.27
// Textures pulled from a public CDN (jsDelivr) so we don't have to
// ship 10MB of binary assets in the repo. Suspense around the
// scene handles the load gracefully — falls back to nothing while
// fetching, never block-renders.

const EARTH_RADIUS = 5
const CLOUDS_RADIUS = EARTH_RADIUS * 1.008
const ATMOSPHERE_RADIUS = EARTH_RADIUS * 1.065

// NASA Blue Marble + supporting maps, pulled directly from the
// three-globe GitHub repo via jsDelivr (the npm @-tagged path
// doesn't include the example/img/ assets, so jsdelivr/gh is the
// reliable source). CORS-enabled, properly cached. The crossOrigin
// flag below tells the texture loader to request anonymously so
// the GL upload doesn't get tainted.
const TEX_URL = 'https://cdn.jsdelivr.net/gh/vasturiano/three-globe@master/example/img'
const TEXTURES = {
  day: `${TEX_URL}/earth-blue-marble.jpg`,
  topology: `${TEX_URL}/earth-topology.png`,
  night: `${TEX_URL}/earth-night.jpg`,
  clouds: `${TEX_URL}/earth-water.png`,
}

// ============================================
// Atmosphere shader — fresnel rim glow that's strongest at
// the limb and falls off to nothing at the dead center. The
// material renders on the INSIDE of a slightly larger sphere
// (side: BackSide) so the back-faces compose the halo seen from
// the camera — classic technique.
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
  // Fresnel — bright at glancing angles, dim head-on.
  float fres = pow(1.0 - dot(vNormal, viewDir), 2.4);
  // Tint warmer on the sun-facing limb, cooler on the night side.
  float sun = max(0.0, dot(vNormal, normalize(uSunDir)));
  vec3 cool = vec3(0.30, 0.62, 1.10);
  vec3 warm = vec3(0.95, 0.78, 0.60);
  vec3 col = mix(cool, warm, sun * 0.55);
  gl_FragColor = vec4(col, fres * 1.35);
}
`

// ============================================
// EARTH MESH
// ============================================
function Earth() {
  const earthRef = useRef<THREE.Mesh>(null)
  const cloudsRef = useRef<THREE.Mesh>(null)
  const atmoRef = useRef<THREE.ShaderMaterial>(null)

  // useLoader throws a Promise during render until textures resolve,
  // which Suspense catches. All 4 load in parallel.
  const [dayMap, topoMap, nightMap, cloudsMap] = useLoader(THREE.TextureLoader, [
    TEXTURES.day,
    TEXTURES.topology,
    TEXTURES.night,
    TEXTURES.clouds,
  ])

  // Sharper texture sampling. useEffect (not render-time) avoids
  // re-mutating every frame; the textures are stable refs from
  // useLoader so deps need only be [dayMap, nightMap].
  useEffect(() => {
    for (const m of [dayMap, nightMap]) {
      m.anisotropy = 8
      m.colorSpace = THREE.SRGBColorSpace
      m.needsUpdate = true
    }
  }, [dayMap, nightMap])

  // Sun direction — drives both the directional light and the
  // atmosphere shader so the warm-side glow lines up with daylight.
  const sunDir = useMemo(() => new THREE.Vector3(1, 0.25, 0.6).normalize(), [])

  const atmoUniforms = useMemo(
    () => ({
      uSunDir: { value: sunDir.clone() },
    }),
    [sunDir],
  )

  useFrame((_, delta) => {
    // Slow axial spin — about one full rotation every 4 minutes of
    // real time. Slow enough to feel grand, fast enough that you
    // can see continents move during a session.
    if (earthRef.current) earthRef.current.rotation.y += delta * 0.026
    // Clouds drift slightly faster than the surface for parallax.
    if (cloudsRef.current) cloudsRef.current.rotation.y += delta * 0.032
  })

  return (
    <group>
      {/* The Earth itself. Day map for color, topology as a
          normal-style relief through bumpMap (subtle; just enough
          to catch limb light). emissiveMap = night-side city lights
          which kick in on the unlit hemisphere because emissive
          ignores scene lighting. */}
      <mesh ref={earthRef}>
        <sphereGeometry args={[EARTH_RADIUS, 128, 128]} />
        <meshStandardMaterial
          map={dayMap}
          bumpMap={topoMap}
          bumpScale={0.06}
          emissiveMap={nightMap}
          emissive={new THREE.Color('#ffe8b0')}
          emissiveIntensity={0.55}
          roughness={0.92}
          metalness={0.0}
        />
      </mesh>

      {/* Cloud sheet floating just above the surface. The
          alpha-mask cloud texture from three-globe is a luminance
          map, so we wire it as alphaMap + a white base for clean
          edges. depthWrite false so atmospherics behind it still
          composite. */}
      <mesh ref={cloudsRef}>
        <sphereGeometry args={[CLOUDS_RADIUS, 96, 96]} />
        <meshStandardMaterial
          alphaMap={cloudsMap}
          color="#ffffff"
          transparent
          opacity={0.6}
          depthWrite={false}
        />
      </mesh>

      {/* Atmosphere halo — BackSide rendering on a larger sphere
          so only the rim-facing back-faces compose, producing the
          characteristic blue limb glow seen from orbit. */}
      <mesh>
        <sphereGeometry args={[ATMOSPHERE_RADIUS, 96, 96]} />
        <shaderMaterial
          ref={atmoRef}
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
// FALLBACK while textures load
// ============================================
function LoadingPlanet() {
  return (
    <mesh>
      <sphereGeometry args={[EARTH_RADIUS, 32, 32]} />
      <meshBasicMaterial color="#0a1a3a" wireframe />
    </mesh>
  )
}

// ============================================
// SCENE
// ============================================
export default function EarthScene() {
  return (
    <Canvas
      camera={{ position: [0, 1.5, 14], fov: 42 }}
      gl={{
        antialias: true,
        powerPreference: 'high-performance',
      }}
      dpr={[1, 2]}
      onCreated={({ gl }) => {
        // Set tone mapping + color space after renderer construction
        // (more reliable than passing in gl props, which some r3f
        // versions don't forward correctly).
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.outputColorSpace = THREE.SRGBColorSpace
      }}
    >
      {/* Deep-space backdrop — nearly black with a hint of blue. */}
      <color attach="background" args={['#020208']} />

      {/* Ambient just enough to keep the night side faintly readable
          beyond the city-light emissive. */}
      <ambientLight intensity={0.08} color="#7080a0" />

      {/* Directional sun light — angled to match the atmosphere
          shader's sun direction so day/night terminator is
          consistent between mesh shading and the limb glow. */}
      <directionalLight
        position={[24, 6, 14]}
        intensity={2.4}
        color="#fff7d6"
      />

      {/* Subtle backside fill so the night hemisphere doesn't go
          dead-black. Pure rim light, no shadow casting. */}
      <directionalLight
        position={[-18, -4, -10]}
        intensity={0.12}
        color="#445080"
      />

      <Suspense fallback={<LoadingPlanet />}>
        <Earth />
      </Suspense>

      {/* Deep starfield, far enough away that camera dolly doesn't
          parallax it weirdly. Saturation 0 = pure white pinpricks. */}
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
  )
}
