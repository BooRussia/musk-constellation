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
// Drapes slippy-map tiles on the globe around whatever point the camera is
// looking at, picking the Mercator zoom level from the camera altitude.
// Stays completely dormant (zero network) until you zoom in past the point
// where the 8K base texture runs out of detail, then streams progressively
// sharper tiles — a mini Google-Earth LOD layer. Tiles are managed
// imperatively (three objects in a ref'd group) to avoid React churn.

const EARTH_RADIUS = 5
// Float just above the base sphere — over the globe texture, but below the
// border / graticule / label overlays (radius 5.015+) so those stay on top.
const TILE_RADIUS = EARTH_RADIUS * 1.0008
const DEG2RAD = Math.PI / 180

const SEG = 8 // patch subdivisions per tile edge (curves it onto the sphere)
const GRID_R = 2 // load a (2R+1)² block of tiles around the focus point
const MIN_ACTIVE_Z = 6 // below this the base 8K globe is already sharper
const MAX_Z = 16
const MAX_CACHE = 96 // hard cap on retained tiles (LRU-ish eviction)
const RECOMPUTE_S = 0.16 // throttle the tile-set recompute (clock seconds)

interface TileRec {
  key: string
  want: boolean
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
      uv[u++] = 1 - fy // image top row = north edge
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
  const dirRef = useRef(new THREE.Vector3())

  // Dispose everything on unmount (toggle off / leave view).
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

    // Provider switch → drop the whole cache and reload fresh.
    if (provider !== providerRef.current) {
      for (const t of tiles.values()) {
        if (t.mesh) group.remove(t.mesh)
        disposeTile(t)
      }
      tiles.clear()
      providerRef.current = provider
    }

    // Smoothly fade tiles in/out every frame (opacity follows `want`).
    for (const t of tiles.values()) {
      if (!t.mesh || !t.mat) continue
      const target = t.want ? 1 : 0
      t.fade += (target - t.fade) * Math.min(1, delta * 6)
      t.mat.opacity = t.fade
      t.mesh.visible = t.fade > 0.01
    }

    // Throttle the (more expensive) recompute of which tiles we need.
    const now = state.clock.elapsedTime
    if (now - lastComputeRef.current < RECOMPUTE_S) return
    lastComputeRef.current = now

    const dist = camera.position.length()
    const altUnits = dist - EARTH_RADIUS
    for (const t of tiles.values()) t.want = false

    if (altUnits > 0) {
      // Focus = the point on the sphere directly under the camera.
      const dir = dirRef.current.copy(camera.position).normalize()
      const lat = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) / DEG2RAD
      const lon = Math.atan2(-dir.z, dir.x) / DEG2RAD
      const latC = THREE.MathUtils.clamp(lat, -85, 85)

      // Pick the Mercator zoom from how much ground the view spans.
      const altKm = altUnits * KM_PER_UNIT
      const fovHalf = (((camera as THREE.PerspectiveCamera).fov ?? 42) * DEG2RAD) / 2
      const visibleKm = Math.max(2 * altKm * Math.tan(fovHalf), 1e-3)
      const maxZoom = Math.min(MAX_Z, TILE_PROVIDERS[provider].maxZoom)
      const z = THREE.MathUtils.clamp(
        Math.round(Math.log2((EARTH_CIRC_KM * 3) / visibleKm)),
        0,
        maxZoom,
      )

      if (z >= MIN_ACTIVE_Z) {
        const n = 2 ** z
        const fx = lon2tileX(lon, z)
        const fy = lat2tileY(latC, z)
        for (let dy = -GRID_R; dy <= GRID_R; dy++) {
          const ty = fy + dy
          if (ty < 0 || ty >= n) continue
          for (let dx = -GRID_R; dx <= GRID_R; dx++) {
            let tx = (fx + dx) % n
            if (tx < 0) tx += n
            const key = `${z}/${tx}/${ty}`
            const existing = tiles.get(key)
            if (existing) {
              existing.want = true
              continue
            }
            const rec: TileRec = {
              key,
              want: true,
              fade: 0,
              loading: true,
              mesh: null,
              geo: null,
              mat: null,
              tex: null,
            }
            tiles.set(key, rec)
            const url = TILE_PROVIDERS[provider].url(z, tx, ty)
            loader.load(
              url,
              (tex) => {
                const cur = tiles.get(key)
                if (!cur) {
                  tex.dispose()
                  return // evicted before it finished loading
                }
                tex.colorSpace = THREE.SRGBColorSpace
                tex.anisotropy = maxAniso
                tex.minFilter = THREE.LinearMipmapLinearFilter
                tex.magFilter = THREE.LinearFilter
                const geo = buildTileGeometry(tx, ty, z)
                const mat = new THREE.MeshBasicMaterial({
                  map: tex,
                  transparent: true,
                  opacity: 0,
                  depthWrite: false,
                })
                const mesh = new THREE.Mesh(geo, mat)
                mesh.renderOrder = 2
                mesh.raycast = () => {} // never intercept pointer picks
                cur.tex = tex
                cur.geo = geo
                cur.mat = mat
                cur.mesh = mesh
                cur.loading = false
                groupRef.current?.add(mesh)
              },
              undefined,
              () => {
                tiles.delete(key) // network/CORS error → allow a later retry
              },
            )
          }
        }
      }
    }

    // Evict tiles we no longer want once they've faded out.
    for (const [key, t] of tiles) {
      if (!t.want && !t.loading && t.fade <= 0.02) {
        if (t.mesh) group.remove(t.mesh)
        disposeTile(t)
        tiles.delete(key)
      }
    }
    // Hard cache cap — shed surplus non-wanted tiles oldest-first.
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
