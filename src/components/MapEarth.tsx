import { Suspense, useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'

// ============================================
// MAP-MODE EARTH (dark)
// ============================================
// A stylized flat-shaded Earth in a DARK "map" theme (like Google Maps'
// dark mode / a tactical display): near-black navy oceans, dark slate
// landmasses, glowing cyan coastlines, and a faint lon/lat graticule.
// No shading / normal map / night lights / specular — reads as a clean
// dark infographic next to the photoreal Earth used in Satellite mode.
//
// IMPLEMENTATION: we sample the existing earth_atmos_2048.jpg as a
// luminance source. The Blue Marble texture's oceans are dark and
// land is bright(er), so a simple threshold on luminance gives us
// recognizable continent shapes without needing a separate Natural
// Earth asset. A small smoothstep window gives clean coastlines
// without aliasing. Output is unshaded — just the flat color, so
// the Earth reads as a map projection wrapped on a sphere.

const EARTH_RADIUS = 5

// BASE_URL prefix (not a root-absolute "/textures/...") so this
// resolves under the GitHub Pages /musk-constellation/ base too.
// Vite doesn't rewrite string-literal asset paths.
const MAP_TEXTURE_PATH = `${import.meta.env.BASE_URL}textures/planets/earth_day_8k.jpg`

const MAP_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// Dark map: near-black navy ocean, dark slate land, glowing cyan
// coastlines. The lon/lat grid is now the toggleable <Graticule />
// overlay (shared across all maps), so it's not baked in here.
const MAP_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;

// Dark-mode palette.
const vec3 OCEAN = vec3(0.018, 0.040, 0.082);  // deep navy, near-black
const vec3 LAND  = vec3(0.090, 0.120, 0.150);  // dark slate landmass
const vec3 COAST = vec3(0.30, 0.85, 1.00);     // glowing cyan coastline

void main() {
  vec3 src = texture2D(uMap, vUv).rgb;

  // Blue Marble oceans skew strongly blue (B > R). Use a
  // blue-vs-red bias as the water mask — far more reliable than
  // raw luminance, which falsely flags bright deserts as water.
  float waterMask = src.b - src.r;
  // Smooth threshold around the typical land/water transition.
  float land = 1.0 - smoothstep(0.04, 0.10, waterMask);

  vec3 col = mix(OCEAN, LAND, land);

  // Glowing coastline — a bright cyan line right at the land/water edge.
  float coast = smoothstep(0.04, 0.06, waterMask) * (1.0 - smoothstep(0.06, 0.085, waterMask));
  col += COAST * coast * 0.95;

  gl_FragColor = vec4(col, 1.0);
}
`

interface MapEarthProps {
  // Optional callback so the parent can swap in a fallback if the
  // texture fails to load. In practice the texture is committed to
  // the repo so this should never fire.
  onTextureFail?: () => void
}

export default function MapEarth({ onTextureFail }: MapEarthProps) {
  const [mapTexture, setMapTexture] = useState<THREE.Texture | null>(null)

  useEffect(() => {
    let cancelled = false
    const loader = new THREE.TextureLoader()
    loader
      .loadAsync(MAP_TEXTURE_PATH)
      .then((tex) => {
        if (cancelled) return
        tex.anisotropy = 16
        // We're sampling the texture purely as a data source for the
        // shader (luminance / channel comparisons), so leave it in
        // linear color space — sRGB conversion would shift the
        // thresholds.
        tex.colorSpace = THREE.NoColorSpace
        tex.needsUpdate = true
        setMapTexture(tex)
      })
      .catch((err) => {
        if (cancelled) return
        console.warn('[MapEarth] map texture failed to load:', err)
        onTextureFail?.()
      })
    return () => {
      cancelled = true
    }
  }, [onTextureFail])

  // Uniforms object is recreated whenever the texture instance
  // changes, so the shader always reads the latest map. No imperative
  // sync needed.
  const uniforms = useMemo(
    () => ({ uMap: { value: mapTexture } }),
    [mapTexture],
  )

  return (
    <Suspense fallback={null}>
      <mesh>
        <sphereGeometry args={[EARTH_RADIUS, 128, 128]} />
        {mapTexture ? (
          <shaderMaterial
            vertexShader={MAP_VERT}
            fragmentShader={MAP_FRAG}
            uniforms={uniforms}
          />
        ) : (
          // Pre-texture: render a flat dark-ocean sphere so the user
          // sees the right silhouette while the texture streams in.
          // meshBasicMaterial guarantees no lighting math.
          <meshBasicMaterial color="#050a14" />
        )}
      </mesh>
    </Suspense>
  )
}
