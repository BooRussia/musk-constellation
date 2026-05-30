import { Suspense, useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'

// ============================================
// MAP-MODE EARTH
// ============================================
// A stylized flat-shaded Earth, modeled after Google Maps' "Map" view
// (as opposed to "Satellite"). Two-tone political-map aesthetic:
// pale blue oceans, cream/sand continents, no shading, no normal
// map, no night lights, no specular. Reads as a clean infographic
// next to the photoreal Earth used in Satellite mode.
//
// IMPLEMENTATION: we sample the existing earth_atmos_2048.jpg as a
// luminance source. The Blue Marble texture's oceans are dark and
// land is bright(er), so a simple threshold on luminance gives us
// recognizable continent shapes without needing a separate Natural
// Earth asset. A small smoothstep window gives clean coastlines
// without aliasing. Output is unshaded — just the flat color, so
// the Earth reads as a map projection wrapped on a sphere.

const EARTH_RADIUS = 5

const MAP_TEXTURE_PATH = '/textures/planets/earth_atmos_2048.jpg'

const MAP_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// Two-tone map: ocean cream-blue, land warm sand. Coastlines emerge
// from the luminance edge between them. We also paint subtle polar
// caps by latitude so the poles read as ice on the map (matches
// how Google Maps and most political maps handle the poles).
const MAP_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;

// Google-Maps-light palette. Tuned for a clean infographic feel —
// the ocean is a soft pale blue, the land a warm cream that reads
// as "paper" against the dark space background.
const vec3 OCEAN = vec3(0.78, 0.86, 0.93);
const vec3 LAND  = vec3(0.96, 0.93, 0.84);
const vec3 ICE   = vec3(0.97, 0.98, 1.00);
const vec3 COAST = vec3(0.55, 0.65, 0.75);

void main() {
  vec3 src = texture2D(uMap, vUv).rgb;

  // Blue Marble oceans skew strongly blue (B > R). Use a
  // blue-vs-red bias as the water mask — far more reliable than
  // raw luminance, which falsely flags bright deserts as water.
  float waterMask = src.b - src.r;
  // Smooth threshold around the typical land/water transition.
  // Tight window keeps coastlines crisp without aliasing.
  float land = 1.0 - smoothstep(0.04, 0.10, waterMask);

  vec3 col = mix(OCEAN, LAND, land);

  // Thin coastline accent — where land mask transitions, paint a
  // subtle darker line so continents have a defined edge.
  float coast = smoothstep(0.04, 0.06, waterMask) * (1.0 - smoothstep(0.06, 0.08, waterMask));
  col = mix(col, COAST, coast * 0.45);

  // Polar caps by latitude. vUv.y goes 0..1 from south to north,
  // so distance from the equator (0.5) drives the ice mask.
  float lat = abs(vUv.y - 0.5) * 2.0;
  float ice = smoothstep(0.86, 0.96, lat);
  col = mix(col, ICE, ice);

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
        tex.anisotropy = 8
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
          // Pre-texture: render a flat ocean-colored sphere so the
          // user sees the right silhouette while the texture streams
          // in. meshBasicMaterial guarantees no lighting math.
          <meshBasicMaterial color="#c7d6e3" />
        )}
      </mesh>
    </Suspense>
  )
}
