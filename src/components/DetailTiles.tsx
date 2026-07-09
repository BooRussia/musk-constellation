import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  TILE_PROVIDERS,
  type TileProvider,
  KM_PER_UNIT,
  EARTH_CIRC_KM,
  tileX2lon,
  tileY2lat,
  lon2tileX,
  lat2tileY,
} from '../lib/tiles'

// ============================================
// DetailTiles — streaming Web-Mercator tile mosaic
// ============================================
// Drapes slippy-map tiles over the *entire visible Earth disk* (frustum
// projected onto the sphere), not a small patch around look-at. That way
// launch-chase / zoomed views never show a hard mosaic edge mid-frame.
// Zoom is capped so the footprint stays within a tile budget; coarser
// underlays fill while sharp tiles stream. Imperative Three objects —
// no React churn per tile.

const EARTH_RADIUS = 5
// Float just above the base sphere — over the globe texture, but below the
// border / graticule / label overlays (radius 5.015+) so those stay on top.
const TILE_RADIUS = EARTH_RADIUS * 1.0008
const DEG2RAD = Math.PI / 180

const SEG = 6 // patch subdivisions per tile edge (curves it onto the sphere)
const MIN_ACTIVE_Z = 5 // below this the base 8K globe is already sharper
const MAX_Z = 14
/** Soft cap on tiles across the longer visible axis — keeps network + GPU sane. */
const MAX_TILES_ACROSS = 18
/** Extra tile ring past the frustum so the edge never peeks into frame. */
const MARGIN_TILES = 2
const MAX_CACHE = 640
const RECOMPUTE_S = 0.25
const STICKY_S = 10
const ZOOM_HYSTERESIS = 0.9
const FADE_IN = 6
const FADE_OUT = 1.1

/** NDC samples covering the viewport (corners + edges + center). */
const NDC_SAMPLES: Array<[number, number]> = [
  [0, 0],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-0.5, -0.5],
  [0.5, -0.5],
  [-0.5, 0.5],
  [0.5, 0.5],
]

interface TileRec {
  key: string
  want: boolean
  stickyUntil: number
  fade: number
  loading: boolean
  mesh: THREE.Mesh | null
  geo: THREE.BufferGeometry | null
  mat: THREE.MeshBasicMaterial | null
  tex: THREE.Texture | null
}

function latLonToVec(lat: number, lon: number, r: number, out: THREE.Vector3) {
  const phi = lat * DEG2RAD
  const lam = lon * DEG2RAD
  const cp = Math.cos(phi)
  return out
    .set(cp * Math.cos(lam), Math.sin(phi), -cp * Math.sin(lam))
    .multiplyScalar(r)
}

function buildTileGeometry(x: number, y: number, z: number): THREE.BufferGeometry {
  const lonW = tileX2lon(x, z)
  const lonE = tileX2lon(x + 1, z)
  const latN = tileY2lat(y, z)
  const latS = tileY2lat(y + 1, z)
  const row = SEG + 1
  const pos = new Float32Array(row * row * 3)
  const uv = new Float32Array(row * row * 2)
  const v = new THREE.Vector3()
  let p = 0
  let u = 0
  for (let j = 0; j <= SEG; j++) {
    const fy = j / SEG
    const lat = latN + (latS - latN) * fy
    for (let i = 0; i <= SEG; i++) {
      const fx = i / SEG
      const lon = lonW + (lonE - lonW) * fx
      latLonToVec(lat, lon, TILE_RADIUS, v)
      pos[p++] = v.x
      pos[p++] = v.y
      pos[p++] = v.z
      uv[u++] = fx
      uv[u++] = 1 - fy
    }
  }
  const idx: number[] = []
  for (let j = 0; j < SEG; j++) {
    for (let i = 0; i < SEG; i++) {
      const a = j * row + i
      const b = a + 1
      const c = a + row
      const d = c + 1
      idx.push(a, c, b, b, c, d)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geo.setIndex(idx)
  return geo
}

function disposeTile(t: TileRec) {
  t.geo?.dispose()
  t.mat?.dispose()
  t.tex?.dispose()
}

/** Ray ∩ Earth sphere; returns true and writes the hit into `out`. */
function rayHitEarth(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  out: THREE.Vector3,
): boolean {
  const b = origin.dot(dir)
  const c = origin.lengthSq() - EARTH_RADIUS * EARTH_RADIUS
  const disc = b * b - c
  if (disc < 0) return false
  const sq = Math.sqrt(disc)
  const t1 = -b - sq
  const t2 = -b + sq
  const t = t1 > 1e-4 ? t1 : t2 > 1e-4 ? t2 : -1
  if (t < 0) return false
  out.copy(origin).addScaledVector(dir, t)
  return true
}

function vecToLatLon(v: THREE.Vector3): { lat: number; lon: number } {
  const r = v.length() || 1
  const lat = Math.asin(THREE.MathUtils.clamp(v.y / r, -1, 1)) / DEG2RAD
  const lon = Math.atan2(-v.z, v.x) / DEG2RAD
  return { lat: THREE.MathUtils.clamp(lat, -85, 85), lon }
}

/** Mercator tile width in km at a given zoom (equatorial). */
function tileWidthKm(z: number): number {
  return EARTH_CIRC_KM / 2 ** z
}

interface Props {
  provider: TileProvider
}

export default function DetailTiles({ provider }: Props) {
  const groupRef = useRef<THREE.Group>(null)
  const { camera, gl } = useThree()

  const loader = useMemo(() => {
    const l = new THREE.TextureLoader()
    l.setCrossOrigin('anonymous')
    return l
  }, [])
  const maxAniso = useMemo(() => gl.capabilities.getMaxAnisotropy(), [gl])

  const tilesRef = useRef(new Map<string, TileRec>())
  const lastComputeRef = useRef(0)
  const providerRef = useRef(provider)
  const stickyZRef = useRef<number | null>(null)
  const hitRef = useRef(new THREE.Vector3())
  const ndcRef = useRef(new THREE.Vector3())
  const worldRef = useRef(new THREE.Vector3())
  const dirRef = useRef(new THREE.Vector3())
  const hitsRef = useRef<Array<{ lat: number; lon: number }>>([])

  useEffect(() => {
    const tiles = tilesRef.current
    return () => {
      for (const t of tiles.values()) disposeTile(t)
      tiles.clear()
    }
  }, [])

  useFrame((state, delta) => {
    const group = groupRef.current
    if (!group) return
    const tiles = tilesRef.current
    const now = state.clock.elapsedTime

    if (provider !== providerRef.current) {
      for (const t of tiles.values()) {
        if (t.mesh) group.remove(t.mesh)
        disposeTile(t)
      }
      tiles.clear()
      providerRef.current = provider
      stickyZRef.current = null
    }

    for (const t of tiles.values()) {
      if (!t.mesh || !t.mat) continue
      const target = t.want ? 1 : 0
      const rate = t.want ? FADE_IN : FADE_OUT
      t.fade += (target - t.fade) * Math.min(1, delta * rate)
      t.mat.opacity = t.fade
      // Only write depth once nearly opaque — otherwise fading tiles punch
      // holes that hide satellites during stream-in.
      t.mat.depthWrite = t.fade > 0.92
      t.mesh.visible = t.fade > 0.01
    }

    if (now - lastComputeRef.current < RECOMPUTE_S) return
    lastComputeRef.current = now

    const dist = camera.position.length()
    const altUnits = dist - EARTH_RADIUS

    for (const t of tiles.values()) {
      if (t.want) t.stickyUntil = now + STICKY_S
      t.want = false
    }

    if (altUnits <= 0) {
      stickyZRef.current = null
    } else {
      // Project viewport samples onto Earth → the visible ground footprint.
      const hits = hitsRef.current
      hits.length = 0
      const cam = camera as THREE.PerspectiveCamera
      cam.updateMatrixWorld()
      for (const [nx, ny] of NDC_SAMPLES) {
        ndcRef.current.set(nx, ny, 0.5)
        ndcRef.current.unproject(cam)
        dirRef.current.copy(ndcRef.current).sub(cam.position).normalize()
        if (rayHitEarth(cam.position, dirRef.current, hitRef.current)) {
          hits.push(vecToLatLon(hitRef.current))
        }
      }
      // Always include camera nadir so we have at least one sample.
      worldRef.current.copy(cam.position).normalize().multiplyScalar(EARTH_RADIUS)
      hits.push(vecToLatLon(worldRef.current))

      // Angular span of hits from Earth center → pick zoom that covers it.
      let maxAng = 0
      const focus = hits[0]
      const focusDir = latLonToVec(focus.lat, focus.lon, 1, worldRef.current).clone()
      for (const h of hits) {
        const d = latLonToVec(h.lat, h.lon, 1, hitRef.current)
        maxAng = Math.max(maxAng, focusDir.angleTo(d))
      }
      // Ground arc length across the view (chord → arc), with padding.
      const arcKm = Math.max(EARTH_RADIUS * KM_PER_UNIT * maxAng * 2.4, 80)

      const maxZoom = Math.min(MAX_Z, TILE_PROVIDERS[provider].maxZoom)
      // Ideal z from pixel density, then clamp so tile count fits the budget.
      const altKm = altUnits * KM_PER_UNIT
      const fovHalf = ((cam.fov ?? 42) * DEG2RAD) / 2
      const visibleKm = Math.max(2 * altKm * Math.tan(fovHalf), 1e-3)
      let idealZ = Math.log2((EARTH_CIRC_KM * 2.2) / visibleKm)
      // Cap: arcKm / tileWidth <= MAX_TILES_ACROSS
      const zForBudget = Math.log2(EARTH_CIRC_KM / (arcKm / MAX_TILES_ACROSS))
      idealZ = Math.min(idealZ, zForBudget)
      idealZ = THREE.MathUtils.clamp(idealZ, 0, maxZoom)

      let z = stickyZRef.current
      if (z == null || Math.abs(idealZ - z) >= ZOOM_HYSTERESIS) {
        z = Math.round(idealZ)
        stickyZRef.current = z
      }
      z = THREE.MathUtils.clamp(z, 0, maxZoom)

      if (z >= MIN_ACTIVE_Z) {
        // Lon/lat → tile AABB. Handle antimeridian by picking the smaller wrap.
        let minLat = 90
        let maxLat = -90
        const lons: number[] = []
        for (const h of hits) {
          minLat = Math.min(minLat, h.lat)
          maxLat = Math.max(maxLat, h.lat)
          lons.push(h.lon)
        }
        // Expand bbox a bit so limb / FOV edges stay covered.
        const padDeg = Math.max(2, (tileWidthKm(z) / 111) * MARGIN_TILES)
        minLat = THREE.MathUtils.clamp(minLat - padDeg, -85, 85)
        maxLat = THREE.MathUtils.clamp(maxLat + padDeg, -85, 85)

        const ensure = (tz: number, tx: number, ty: number) => {
          const n = 2 ** tz
          if (ty < 0 || ty >= n) return
          let x = tx % n
          if (x < 0) x += n
          const key = `${tz}/${x}/${ty}`
          const existing = tiles.get(key)
          if (existing) {
            existing.want = true
            existing.stickyUntil = now + STICKY_S
            return
          }
          const rec: TileRec = {
            key,
            want: true,
            stickyUntil: now + STICKY_S,
            fade: 0,
            loading: true,
            mesh: null,
            geo: null,
            mat: null,
            tex: null,
          }
          tiles.set(key, rec)
          const url = TILE_PROVIDERS[provider].url(tz, x, ty)
          loader.load(
            url,
            (tex) => {
              const cur = tiles.get(key)
              if (!cur) {
                tex.dispose()
                return
              }
              tex.colorSpace = THREE.SRGBColorSpace
              tex.anisotropy = maxAniso
              tex.minFilter = THREE.LinearMipmapLinearFilter
              tex.magFilter = THREE.LinearFilter
              const geo = buildTileGeometry(x, ty, tz)
              const mat = new THREE.MeshBasicMaterial({
                map: tex,
                transparent: true,
                opacity: 0,
                depthWrite: true, // write depth so sats depth-test correctly above
                depthTest: true,
              })
              const mesh = new THREE.Mesh(geo, mat)
              mesh.renderOrder = tz < z ? 1 : 2
              mesh.raycast = () => {}
              cur.tex = tex
              cur.geo = geo
              cur.mat = mat
              cur.mesh = mesh
              cur.loading = false
              groupRef.current?.add(mesh)
            },
            undefined,
            () => {
              tiles.delete(key)
            },
          )
        }

        const fillLevel = (tz: number, margin: number) => {
          const n = 2 ** tz
          const y0 = Math.max(0, lat2tileY(maxLat, tz) - margin)
          const y1 = Math.min(n - 1, lat2tileY(minLat, tz) + margin)
          // Build x ranges — unwrap longitudes around the focus lon.
          const focusLon = focus.lon
          let minX = Infinity
          let maxX = -Infinity
          for (const lon of lons) {
            // Normalize lon relative to focus into (-180, 180]
            let d = lon - focusLon
            while (d > 180) d -= 360
            while (d < -180) d += 360
            const lx = focusLon + d
            // Convert via a shifted lon that stays continuous for tileX
            const tx = lon2tileX(lx, tz)
            minX = Math.min(minX, tx)
            maxX = Math.max(maxX, tx)
          }
          minX -= margin
          maxX += margin
          // Also ensure we cover at least the focus tile.
          const ftx = lon2tileX(focusLon, tz)
          minX = Math.min(minX, ftx - margin)
          maxX = Math.max(maxX, ftx + margin)

          for (let ty = y0; ty <= y1; ty++) {
            for (let tx = Math.floor(minX); tx <= Math.ceil(maxX); tx++) {
              ensure(tz, tx, ty)
            }
          }
        }

        // Sharp mosaic covering the full visible footprint.
        fillLevel(z, MARGIN_TILES)
        // Coarser underlays — wider margin, hide any residual edge.
        if (z - 1 >= MIN_ACTIVE_Z) fillLevel(z - 1, MARGIN_TILES + 1)
        if (z - 2 >= MIN_ACTIVE_Z) fillLevel(z - 2, MARGIN_TILES + 2)
      } else {
        stickyZRef.current = null
      }
    }

    for (const t of tiles.values()) {
      if (!t.want && t.stickyUntil > now) t.want = true
    }

    for (const [key, t] of tiles) {
      if (!t.want && !t.loading && t.fade <= 0.02) {
        if (t.mesh) group.remove(t.mesh)
        disposeTile(t)
        tiles.delete(key)
      }
    }
    if (tiles.size > MAX_CACHE) {
      for (const [key, t] of tiles) {
        if (tiles.size <= MAX_CACHE) break
        if (!t.want && !t.loading) {
          if (t.mesh) group.remove(t.mesh)
          disposeTile(t)
          tiles.delete(key)
        }
      }
    }
  })

  return <group ref={groupRef} />
}
