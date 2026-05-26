import { useRef, useEffect, useMemo, useCallback, memo, useState, useLayoutEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import * as d3Force from 'd3-force-3d'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import {
  GROUP_COLORS,
  LINK_COLORS,
  getConnectedIds,
  getNodeById,
  getVisibleNodes,
  getVisibleLinks,
} from '../data/constellation'
import type { Node, Link } from '../data/constellation'

export interface Props {
  selectedId: string | null
  expandedIds: Set<string>
  onSelect: (id: string | null) => void
  onExpand: (parentId: string) => void
  highlightLinkIds?: Set<string>
}

interface SimNode extends Node {
  x?: number
  y?: number
  z?: number
  vx?: number
  vy?: number
  vz?: number
  fx?: number | null
  fy?: number | null
  fz?: number | null
}

interface SimLink extends Omit<Link, 'source' | 'target'> {
  source: SimNode | string
  target: SimNode | string
}

interface D3Simulation {
  alpha(): number
  alpha(value: number): D3Simulation
  alphaTarget(): number
  alphaTarget(value: number): D3Simulation
  tick(): void
  restart(): D3Simulation
  stop(): void
  nodes(): SimNode[]
  nodes(nodes: SimNode[]): D3Simulation
  force(name: string): d3Force.ForceLink<SimNode, SimLink> | undefined
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + seed * 78.233) * 43758.5453
  return x - Math.floor(x)
}

const EMPTY_SET = new Set<string>()

function hashFromId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0
  }
  return h
}

function hashRotation(id: string): [number, number, number] {
  const h = hashFromId(id)
  return [
    ((h & 0xff) / 255) * 0.6,
    (((h >> 8) & 0xff) / 255) * 1.2,
    0,
  ]
}

function fitCameraToNodes(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControlsImpl,
  nodes: SimNode[],
  vecRefs: {
    center: THREE.Vector3
    size: THREE.Vector3
    dir: THREE.Vector3
    point: THREE.Vector3
  },
  padding = 1.75,
) {
  if (nodes.length === 0) return

  const box = new THREE.Box3()
  for (const n of nodes) {
    vecRefs.point.set(n.x ?? 0, n.y ?? 0, n.z ?? 0)
    const r = (n.val || 1) * 0.6
    box.expandByPoint(vecRefs.point.clone().addScalar(r))
    box.expandByPoint(vecRefs.point.clone().addScalar(-r))
  }

  box.getCenter(vecRefs.center)
  box.getSize(vecRefs.size)

  // Fit considering both vertical FOV and the canvas aspect ratio so off-center
  // panels don't cut off nodes.
  const aspect = camera.aspect || 1
  const fovV = camera.fov * (Math.PI / 180)
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * aspect)
  const distV = (Math.max(vecRefs.size.y, vecRefs.size.z * 0.5) / 2) / Math.tan(fovV / 2)
  const distH = (Math.max(vecRefs.size.x, vecRefs.size.z * 0.5) / 2) / Math.tan(fovH / 2)
  let distance = Math.max(distV, distH) * padding
  distance = Math.max(distance, 16)

  vecRefs.dir.set(0.35, 0.22, 1).normalize()
  camera.position.copy(vecRefs.center).add(vecRefs.dir.multiplyScalar(distance))
  controls.target.copy(vecRefs.center)
  controls.update()
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Linear-interpolate two hex colors. Used to derive sub-orb surface shades
 *  from their parent group color (slightly desaturated toward neutral grey). */
function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return `#${[r, g, bl].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function useIsMobile(): boolean {
  return useMemo(() => {
    if (typeof window === 'undefined') return false
    return (
      window.matchMedia('(max-width:768px)').matches ||
      (navigator.hardwareConcurrency ?? 8) <= 4
    )
  }, [])
}

// ============================================
// NODE MESH — imperative position updates via refs Map
// ============================================
interface NodeMeshProps {
  node: Node
  isSelected: boolean
  isConnected: boolean
  hasSelection: boolean
  groupRefs: React.MutableRefObject<Map<string, THREE.Group>>
  onNodeClick: (id: string, e: ThreeEvent<MouseEvent>) => void
  onPointerDown: (id: string, e: ThreeEvent<PointerEvent>) => void
}

const NodeMesh = memo(function NodeMesh({
  node,
  isSelected,
  isConnected,
  hasSelection,
  groupRefs,
  onNodeClick,
  onPointerDown,
}: NodeMeshProps) {
  const groupRef = useRef<THREE.Group>(null)
  const orbMeshRef = useRef<THREE.Mesh>(null)
  const [isHovered, setIsHovered] = useState(false)
  const labelRef = useRef<HTMLDivElement>(null)

  // Per-orb shader material — created once via useState lazy init so it
  // survives re-renders. cores/subs share the nebula shader (intensity
  // differs); externals get the gem shader.
  const [orbMaterial] = useState<THREE.ShaderMaterial>(() => {
    const baseColor = node.color ?? GROUP_COLORS[node.group]
    const surface = node.type === 'sub' ? mixHex(baseColor, '#9aa3b2', 0.22) : baseColor
    if (node.type === 'external') {
      return new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(surface) },
          uTime: { value: 0 },
        },
        vertexShader: NEBULA_VERT,
        fragmentShader: GEM_FRAG,
      })
    }
    const intensity = node.type === 'core' ? 1.0 : 0.55
    const noiseScale = node.type === 'core' ? 1.75 : 2.4
    const speed = node.type === 'core' ? 0.045 : 0.025
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(surface) },
        uTime: { value: 0 },
        uIntensity: { value: intensity },
        uNoiseScale: { value: noiseScale },
        uSpeed: { value: speed },
      },
      vertexShader: NEBULA_VERT,
      fragmentShader: NEBULA_FRAG,
    })
  })

  // Mirror material into a ref so useFrame can write uniforms without
  // tripping the react-hooks/immutability rule that fires on captured
  // render values.
  const materialRef = useRef<THREE.ShaderMaterial | null>(null)
  useLayoutEffect(() => {
    materialRef.current = orbMaterial
    return () => {
      orbMaterial.dispose()
      materialRef.current = null
    }
  }, [orbMaterial])

  // Each orb gets a stable self-rotation speed derived from its id hash
  // so they spin independently (Tesla's surface clouds and SpaceX's
  // don't move in lockstep).
  const rotationSpeed = useMemo(() => {
    const h = hashFromId(node.id)
    const sign = (h & 1) === 0 ? 1 : -1
    return sign * (0.04 + ((h >>> 4) & 0xff) / 255 * 0.06)
  }, [node.id])

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const refs = groupRefs.current
    refs.set(node.id, group)
    return () => {
      refs.delete(node.id)
    }
  }, [node.id, groupRefs])

  // Per-node color override (used for externals) falls back to the group color.
  const color = node.color ?? GROUP_COLORS[node.group]
  const radius = node.val * 0.55
  const ringRotation = useMemo(() => hashRotation(node.id), [node.id])
  // Surface color is computed inside the per-instance orb material below
  // (subs get desaturated toward neutral, externals/cores stay at full
  // group color).
  // Label sits directly below the sphere for predictable positioning at
  // any camera angle. The radius offset keeps the label clear of the
  // glowing core while leaving the connection lines visible above it.
  const labelPosition = useMemo(
    (): [number, number, number] => [0, -(radius + 0.9 + node.val * 0.25), 0],
    [radius, node.val],
  )

  // Per-frame opacity calc — home state hides labels until hovered so the
  // constellation reads as pure colored orbs; selection state uses a
  // distance-aware fade with focus highlighting; hover always wins so the
  // user can browse names freely. Also drives the shader uTime + slow
  // self-rotation so the orb surfaces feel alive.
  const worldPos = useRef(new THREE.Vector3())
  useFrame(({ camera, clock }) => {
    // Surface animation + slow spin so the orb looks like a planet/nebula
    // rather than a flat blob.
    const mat = materialRef.current
    if (mat) mat.uniforms.uTime.value = clock.elapsedTime
    const orb = orbMeshRef.current
    if (orb) orb.rotation.y += rotationSpeed * 0.012

    const el = labelRef.current
    const group = groupRef.current
    if (!el || !group) return

    let target: number

    if (!hasSelection) {
      // Home state — labels hidden by default, revealed by hovering the orb.
      target = isHovered ? 1 : 0
    } else {
      // Selection state — distance-aware fade with focus highlight.
      group.getWorldPosition(worldPos.current)
      const dist = camera.position.distanceTo(worldPos.current)
      if (dist < 32) target = 1
      else if (dist > 80) target = 0
      else if (dist > 70) target = (80 - dist) / 10 * 0.35
      else target = 1 - (dist - 32) / 38 * 0.65

      if (isSelected || isConnected) target = 1
      else target = Math.min(target, 0.22)
      // Hover always wins — lets the user browse names even when something
      // else is selected.
      if (isHovered) target = 1
    }

    el.style.opacity = target.toFixed(3)
  })

  return (
    <group ref={groupRef}>
      <mesh
        ref={orbMeshRef}
        onClick={(e) => onNodeClick(node.id, e)}
        onPointerDown={(e) => onPointerDown(node.id, e)}
        onPointerOver={(e) => {
          e.stopPropagation()
          document.body.style.cursor = 'pointer'
          setIsHovered(true)
        }}
        onPointerOut={(e) => {
          e.stopPropagation()
          document.body.style.cursor = 'default'
          setIsHovered(false)
        }}
        userData={{ nodeId: node.id }}
        material={orbMaterial}
      >
        {/* Type-specific geometry:
             - core/sub → smooth sphere with enough subdivisions for the
               shader's noise to read as continuous surface
             - external → octahedron — faceted gem shape  */}
        {node.type === 'external' ? (
          <octahedronGeometry args={[radius * 1.05, 0]} />
        ) : (
          <sphereGeometry args={[radius, 48, 32]} />
        )}
      </mesh>

      {/* Cores get a tiny bright pinpoint at the center to seed the bloom
          effect — the surface shader handles the broader glow. Subs have
          a calmer center to read as solid moons. Externals get no inner;
          the gem shader carries them. */}
      {node.type === 'core' && (
        <mesh>
          <sphereGeometry args={[radius * 0.18, 16, 12]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      )}

      {/* Persistent halo on cores so they read as "stars" even in home
          state — three concentric thin rings, double-sided. */}
      {node.type === 'core' && (
        <mesh rotation={ringRotation}>
          <ringGeometry args={[radius * 1.18, radius * 1.22, 64]} />
          <meshBasicMaterial
            color={color}
            side={THREE.DoubleSide}
            transparent
            opacity={hasSelection && !isSelected && !isConnected ? 0.18 : 0.45}
          />
        </mesh>
      )}

      {isSelected && (
        <mesh>
          <ringGeometry args={[radius * 1.65, radius * 1.72, 48]} />
          <meshBasicMaterial
            color="#ffffff"
            side={THREE.DoubleSide}
            transparent
            opacity={0.9}
          />
        </mesh>
      )}

      {isConnected && !isSelected && (
        <mesh rotation={ringRotation}>
          <ringGeometry args={[radius * 1.35, radius * 1.42, 36]} />
          <meshBasicMaterial
            color={color}
            side={THREE.DoubleSide}
            transparent
            opacity={0.55}
          />
        </mesh>
      )}

      <Html
        position={labelPosition}
        center
        zIndexRange={[5, 80]}
        wrapperClass="constellation-label-wrap"
        style={{
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        <div
          ref={labelRef}
          className={`constellation-label is-${node.type} ${isSelected ? 'is-selected' : ''} ${isConnected && !isSelected ? 'is-connected' : ''}`}
        >
          {node.label.toUpperCase()}
        </div>
      </Html>
    </group>
  )
})

// ============================================
// LINK LINES — single BufferGeometry, imperative vertex updates
// ============================================
interface LinkLinesProps {
  links: Link[]
  simNodesRef: React.MutableRefObject<SimNode[]>
  selectedId: string | null
  highlightLinkIds: Set<string>
  geometryRef: React.MutableRefObject<THREE.BufferGeometry | null>
  highlightGeometryRef: React.MutableRefObject<THREE.BufferGeometry | null>}

const LinkLines = memo(function LinkLines({
  links,
  simNodesRef,
  selectedId,
  highlightLinkIds,
  geometryRef,
  highlightGeometryRef,
}: LinkLinesProps) {
  const { positions, colors, highlightIndices } = useMemo(() => {
    const pos = new Float32Array(links.length * 6)
    const col = new Float32Array(links.length * 6)
    const hi: number[] = []

    links.forEach((link, i) => {
      const isHighlighted =
        highlightLinkIds.has(`${link.source}-${link.target}`) ||
        highlightLinkIds.has(`${link.target}-${link.source}`)
      // Direction-aware gradient: source node's group color at the source
      // end, target node's group color at the target end. A viewer can see
      // a Tesla→Boring link reading red→yellow (Tesla side starts the line)
      // and immediately knows which way the relationship flows.
      const srcNode = getNodeById(link.source)
      const tgtNode = getNodeById(link.target)
      const srcRgb = hexToRgb(srcNode ? GROUP_COLORS[srcNode.group] : (LINK_COLORS[link.type] || '#888888'))
      const tgtRgb = hexToRgb(tgtNode ? GROUP_COLORS[tgtNode.group] : (LINK_COLORS[link.type] || '#888888'))
      const opacity = isHighlighted ? 0.95 : selectedId ? 0.18 : 0.5
      // Brighten the source end slightly so the gradient reads as "flowing
      // FROM source" rather than as an arbitrary mix.
      const srcMul = opacity * 1.0
      const tgtMul = opacity * 0.55
      const base = i * 6
      col[base + 0] = (srcRgb[0] / 255) * srcMul
      col[base + 1] = (srcRgb[1] / 255) * srcMul
      col[base + 2] = (srcRgb[2] / 255) * srcMul
      col[base + 3] = (tgtRgb[0] / 255) * tgtMul
      col[base + 4] = (tgtRgb[1] / 255) * tgtMul
      col[base + 5] = (tgtRgb[2] / 255) * tgtMul
      if (isHighlighted) hi.push(i)
    })

    return { positions: pos, colors: col, highlightIndices: hi }
  }, [links, highlightLinkIds, selectedId])

  const highlightPositions = useMemo(
    () => new Float32Array(highlightIndices.length * 6),
    [highlightIndices.length],
  )

  useEffect(() => {
    geometryRef.current = null
    highlightGeometryRef.current = null
  }, [geometryRef, highlightGeometryRef, links])

  useFrame(() => {
    const geo = geometryRef.current
    if (!geo) return

    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute
    const arr = posAttr.array as Float32Array
    const nodeMap = new Map(simNodesRef.current.map((n) => [n.id, n]))

    links.forEach((link, i) => {
      const s = nodeMap.get(link.source)
      const t = nodeMap.get(link.target)
      const idx = i * 6
      if (s) {
        arr[idx] = s.x ?? 0
        arr[idx + 1] = s.y ?? 0
        arr[idx + 2] = s.z ?? 0
      }
      if (t) {
        arr[idx + 3] = t.x ?? 0
        arr[idx + 4] = t.y ?? 0
        arr[idx + 5] = t.z ?? 0
      }
    })
    posAttr.needsUpdate = true

    const hiGeo = highlightGeometryRef.current
    if (hiGeo && highlightIndices.length > 0) {
      const hiAttr = hiGeo.getAttribute('position') as THREE.BufferAttribute
      const hiArr = hiAttr.array as Float32Array
      highlightIndices.forEach((linkIdx, i) => {
        const link = links[linkIdx]
        const s = nodeMap.get(link.source)
        const t = nodeMap.get(link.target)
        const idx = i * 6
        if (s) {
          hiArr[idx] = s.x ?? 0
          hiArr[idx + 1] = s.y ?? 0
          hiArr[idx + 2] = s.z ?? 0
        }
        if (t) {
          hiArr[idx + 3] = t.x ?? 0
          hiArr[idx + 4] = t.y ?? 0
          hiArr[idx + 5] = t.z ?? 0
        }
      })
      hiAttr.needsUpdate = true
    }
  })

  return (
    <>
      <lineSegments frustumCulled={false}>
        <bufferGeometry
          ref={(geo) => {
            geometryRef.current = geo as THREE.BufferGeometry | null
          }}
        >
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors transparent linewidth={1} />
      </lineSegments>

      {highlightIndices.length > 0 && (
        <lineSegments frustumCulled={false}>
          <bufferGeometry
            ref={(geo) => {
              highlightGeometryRef.current = geo as THREE.BufferGeometry | null
            }}
          >
            <bufferAttribute
              attach="attributes-position"
              args={[highlightPositions, 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial color="#ffffff" transparent opacity={0.55} linewidth={0.8} />
        </lineSegments>
      )}

      <LinkFlow
        links={links}
        highlightIndices={highlightIndices}
        simNodesRef={simNodesRef}
      />
    </>
  )
})

// ============================================
// LINK FLOW PARTICLES — animated dots travel along each highlighted link
// from source toward target, making the direction of the relationship
// completely unambiguous at a glance.
// ============================================
const FLOW_PARTICLES_PER_LINK = 4
const FLOW_MAX_LINKS = 40
const FLOW_TOTAL = FLOW_PARTICLES_PER_LINK * FLOW_MAX_LINKS
const FLOW_SPEED = 0.35 // 1/seconds — particle traverses link in ~3s

const FLOW_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  uniform float uPixelRatio;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(-mv.z, 1.0);
    gl_PointSize = aSize * (260.0 / dist) * uPixelRatio;
    gl_PointSize = clamp(gl_PointSize, 2.0, 24.0);
    gl_Position = projectionMatrix * mv;
  }
`
const FLOW_FRAG = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float d2 = dot(uv, uv);
    if (d2 > 1.0) discard;
    float core = smoothstep(0.55, 0.0, sqrt(d2));
    float halo = smoothstep(1.0, 0.0, sqrt(d2));
    gl_FragColor = vec4(vColor * (0.5 + core), halo * 0.95);
  }
`

interface LinkFlowProps {
  links: Link[]
  highlightIndices: number[]
  simNodesRef: React.MutableRefObject<SimNode[]>
}

const LinkFlow = memo(function LinkFlow({
  links,
  highlightIndices,
  simNodesRef,
}: LinkFlowProps) {
  const pointsRef = useRef<THREE.Points>(null!)
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1

  // Pre-allocated attribute buffers, owned by component state (lazy init)
  // so useFrame can write into them without tripping the "modify captured
  // render value" lint. useFrame rewrites every active particle each frame
  // and zeros sizes for inactive ones; no separate reset is needed.
  const [positions] = useState(() => new Float32Array(FLOW_TOTAL * 3))
  const [sizes] = useState(() => new Float32Array(FLOW_TOTAL))
  const [colors] = useState(() => new Float32Array(FLOW_TOTAL * 3))

  const [material] = useState(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uPixelRatio: { value: dpr } },
        vertexShader: FLOW_VERT,
        fragmentShader: FLOW_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
  )
  const materialRef = useRef<THREE.ShaderMaterial | null>(null)
  useLayoutEffect(() => {
    materialRef.current = material
    return () => {
      material.dispose()
      materialRef.current = null
    }
  }, [material])

  useFrame(({ clock }) => {
    const pts = pointsRef.current
    if (!pts) return
    const geo = pts.geometry as THREE.BufferGeometry
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute
    const sizeAttr = geo.getAttribute('aSize') as THREE.BufferAttribute
    const colorAttr = geo.getAttribute('aColor') as THREE.BufferAttribute
    const posArr = posAttr.array as Float32Array
    const sizeArr = sizeAttr.array as Float32Array
    const colorArr = colorAttr.array as Float32Array

    if (highlightIndices.length === 0) {
      // Hide all particles.
      sizeArr.fill(0)
      sizeAttr.needsUpdate = true
      return
    }

    const t = clock.elapsedTime
    const nodeMap = new Map(simNodesRef.current.map((n) => [n.id, n]))

    const activeCount = Math.min(highlightIndices.length, FLOW_MAX_LINKS)

    for (let li = 0; li < activeCount; li++) {
      const linkIdx = highlightIndices[li]
      const link = links[linkIdx]
      if (!link) continue
      const s = nodeMap.get(link.source)
      const tg = nodeMap.get(link.target)
      if (!s || !tg) continue

      const sx = s.x ?? 0, sy = s.y ?? 0, sz = s.z ?? 0
      const tx = tg.x ?? 0, ty = tg.y ?? 0, tz = tg.z ?? 0
      const dx = tx - sx, dy = ty - sy, dz = tz - sz

      // Source-node color so particles read as "leaving the source"
      const srcNode = getNodeById(link.source)
      const tgtNode = getNodeById(link.target)
      const srcRgb = srcNode ? hexToRgb(GROUP_COLORS[srcNode.group]) : [255, 255, 255]
      const tgtRgb = tgtNode ? hexToRgb(GROUP_COLORS[tgtNode.group]) : [255, 255, 255]

      for (let p = 0; p < FLOW_PARTICLES_PER_LINK; p++) {
        const offset = p / FLOW_PARTICLES_PER_LINK
        // Travel from 0.08 to 0.92 along the link so particles don't pile
        // up inside the spheres at either end.
        const u = ((t * FLOW_SPEED + offset) % 1)
        const u01 = 0.08 + u * 0.84
        const idx = (li * FLOW_PARTICLES_PER_LINK + p)
        const base = idx * 3

        posArr[base + 0] = sx + dx * u01
        posArr[base + 1] = sy + dy * u01
        posArr[base + 2] = sz + dz * u01

        // Tint shifts from source color near the start to target color
        // near the end so each particle visibly carries the source's
        // identity outward.
        const mixR = srcRgb[0] / 255 * (1 - u01) + tgtRgb[0] / 255 * u01
        const mixG = srcRgb[1] / 255 * (1 - u01) + tgtRgb[1] / 255 * u01
        const mixB = srcRgb[2] / 255 * (1 - u01) + tgtRgb[2] / 255 * u01
        colorArr[base + 0] = mixR
        colorArr[base + 1] = mixG
        colorArr[base + 2] = mixB

        // Brighter / bigger near the head, softer near the tail.
        sizeArr[idx] = 1.6 + u * 1.0
      }
    }

    // Zero-out unused particles past activeCount so they don't render.
    for (let li = activeCount; li < FLOW_MAX_LINKS; li++) {
      for (let p = 0; p < FLOW_PARTICLES_PER_LINK; p++) {
        const idx = li * FLOW_PARTICLES_PER_LINK + p
        sizeArr[idx] = 0
      }
    }

    posAttr.needsUpdate = true
    sizeAttr.needsUpdate = true
    colorAttr.needsUpdate = true
  })

  return (
    <points ref={pointsRef} material={material} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[sizes, 1]} />
        <bufferAttribute attach="attributes-aColor" args={[colors, 3]} />
      </bufferGeometry>
    </points>
  )
})

// ============================================
// 3D SCENE (inside Canvas)
// ============================================
function Scene({
  selectedId,
  expandedIds,
  onSelect,
  highlightLinkIds = EMPTY_SET,
}: Omit<Props, 'onExpand'>) {
  const { camera, raycaster, mouse, scene, size } = useThree()
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const groupRef = useRef<THREE.Group>(null!)

  const simNodesRef = useRef<SimNode[]>([])
  const simLinksRef = useRef<SimLink[]>([])
  const simulationRef = useRef<D3Simulation | null>(null)
  const nodeGroupRefs = useRef<Map<string, THREE.Group>>(new Map())
  const linkGeometryRef = useRef<THREE.BufferGeometry | null>(null)
  const highlightGeometryRef = useRef<THREE.BufferGeometry | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const draggingIdRef = useRef<string | null>(null)
  const flyToRafRef = useRef<number | null>(null)
  const hasInitialFitRef = useRef(false)
  const mountSettledRef = useRef(false)
  const fitKeyRef = useRef('')

  const dragVecs = useRef({
    nodePos: new THREE.Vector3(),
    mouseNDC: new THREE.Vector2(),
    dir: new THREE.Vector3(),
    newPos: new THREE.Vector3(),
  })

  const fitVecs = useRef({
    center: new THREE.Vector3(),
    size: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    point: new THREE.Vector3(),
  })

  const visibleNodes = useMemo(
    () => getVisibleNodes(expandedIds),
    [expandedIds],
  )

  const visibleNodeKey = useMemo(
    () => visibleNodes.map((n) => n.id).sort().join(','),
    [visibleNodes],
  )

  const visibleLinks = useMemo(
    () => getVisibleLinks(visibleNodes),
    [visibleNodes],
  )

  const connectedSet = useMemo(
    () => new Set(selectedId ? getConnectedIds(selectedId) : []),
    [selectedId],
  )

  useEffect(() => {
    hasInitialFitRef.current = false
    fitKeyRef.current = visibleNodeKey
  }, [visibleNodeKey])

  // Refit when the canvas viewport changes size (e.g. sidebar/panel toggle).
  // Only refits if nothing is currently selected so we don't yank the user
  // away from their focused node.
  const cameraRef = useRef<THREE.Camera | null>(null)
  useLayoutEffect(() => {
    cameraRef.current = camera
  }, [camera])
  useEffect(() => {
    if (selectedId) return
    if (!mountSettledRef.current) return
    if (simNodesRef.current.length === 0) return
    const controls = controlsRef.current
    const cam = cameraRef.current as THREE.PerspectiveCamera | null
    if (!controls || !cam) return
    cam.aspect = size.width / size.height
    cam.updateProjectionMatrix()
    fitCameraToNodes(cam, controls, simNodesRef.current, fitVecs.current)
  }, [size.width, size.height, selectedId])

  useEffect(() => {
    const simNodes: SimNode[] = visibleNodes.map((n) => {
      const existing = simNodesRef.current.find((sn) => sn.id === n.id)
      return {
        ...n,
        x: existing?.x ?? (Math.random() - 0.5) * 22,
        y: existing?.y ?? (Math.random() - 0.5) * 18,
        z: existing?.z ?? (Math.random() - 0.5) * 20,
        vx: existing?.vx ?? 0,
        vy: existing?.vy ?? 0,
        vz: existing?.vz ?? 0,
        fx: existing?.fx ?? null,
        fy: existing?.fy ?? null,
        fz: existing?.fz ?? null,
      }
    })

    const idToNode = new Map(simNodes.map((n) => [n.id, n] as const))
    const simLinks: SimLink[] = visibleLinks.map((l) => ({
      ...l,
      source: idToNode.get(l.source)!,
      target: idToNode.get(l.target)!,
    }))

    simNodesRef.current = simNodes
    simLinksRef.current = simLinks

    if (!simulationRef.current) {
      const simRaw = d3Force.forceSimulation(simNodes)
      const linkForce = d3Force
        .forceLink(simLinks)
        .id((d) => (d as SimNode).id)
        .strength((l) => ((l as SimLink).strength || 0.6) * 0.9)
        .distance((l) => {
          const s = (l as SimLink).source as SimNode
          const t = (l as SimLink).target as SimNode
          const baseR = (s.val || 1) + (t.val || 1)
          return Math.max(5, baseR * 2.0)
        })
      simRaw.force('link', linkForce)
      simRaw.force('charge', d3Force.forceManyBody().strength(-10).distanceMax(25))
      simRaw.force('center', d3Force.forceCenter(0, 0, 0))
      // Active centripetal pull on each axis so nodes can't drift to infinity
      simRaw.force('x', d3Force.forceX(0).strength(0.12))
      simRaw.force('y', d3Force.forceY(0).strength(0.14))
      simRaw.force('z', d3Force.forceZ(0).strength(0.12))
      simRaw.force(
        'collision',
        d3Force.forceCollide().radius((d) => (d as SimNode).val * 1.65 + 0.4),
      )
      simRaw.alphaDecay(0.03)
      simRaw.velocityDecay(0.42)

      simulationRef.current = simRaw as unknown as D3Simulation
    } else {
      const s = simulationRef.current
      s.nodes(simNodes)
      const linkForce = s.force('link')
      if (linkForce) linkForce.links(simLinks)
      s.alpha(0.6).restart()
    }

    for (const n of simNodes) {
      const g = nodeGroupRefs.current.get(n.id)
      if (g) {
        g.position.set(n.x ?? 0, n.y ?? 0, n.z ?? 0)
      }
    }
  }, [visibleNodeKey, visibleLinks]) // eslint-disable-line react-hooks/exhaustive-deps -- keyed by visibleNodeKey

  useEffect(() => {
    return () => {
      simulationRef.current?.stop()
      simulationRef.current = null
    }
  }, [])

  useFrame(() => {
    const sim = simulationRef.current
    if (!sim) return

    const alpha = sim.alpha()
    if (alpha >= 0.001 || draggingIdRef.current) {
      const ticks = alpha > 0.08 ? 3 : alpha > 0.02 ? 2 : 1
      for (let i = 0; i < ticks; i++) sim.tick()

      for (const n of simNodesRef.current) {
        const g = nodeGroupRefs.current.get(n.id)
        if (g) {
          g.position.set(n.x ?? 0, n.y ?? 0, n.z ?? 0)
        }
      }
    }

    if (
      !selectedId &&
      !hasInitialFitRef.current &&
      fitKeyRef.current === visibleNodeKey &&
      alpha < 0.05 &&
      simNodesRef.current.length > 0
    ) {
      const controls = controlsRef.current
      if (controls) {
        fitCameraToNodes(
          camera as THREE.PerspectiveCamera,
          controls,
          simNodesRef.current,
          fitVecs.current,
        )
        hasInitialFitRef.current = true
        mountSettledRef.current = true
      }
    }
  })

  const handleCanvasClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (e.delta > 4) return
      raycaster.setFromCamera(mouse, camera)
      const intersects = raycaster.intersectObjects(scene.children, true)
      const nodeMesh = intersects.find((i) => i.object.userData?.nodeId)
      if (nodeMesh) {
        const id = nodeMesh.object.userData.nodeId as string
        onSelect(id)
      } else if (selectedId) {
        onSelect(null)
      }
    },
    [camera, mouse, raycaster, scene, onSelect, selectedId],
  )

  const handleNodeClick = useCallback(
    (id: string, e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation()
      if (e.delta > 3) return
      onSelect(id)
    },
    [onSelect],
  )

  const handlePointerDown = useCallback((id: string, e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    draggingIdRef.current = id
    setDraggingId(id)
    const node = simNodesRef.current.find((n) => n.id === id)
    if (node) {
      node.fx = node.x
      node.fy = node.y
      node.fz = node.z
    }
    simulationRef.current?.alphaTarget(0.25).restart()
  }, [])

  const handlePointerUp = useCallback(() => {
    const dragId = draggingIdRef.current
    if (!dragId) return
    const node = simNodesRef.current.find((n) => n.id === dragId)
    if (node) {
      node.fx = null
      node.fy = null
      node.fz = null
    }
    draggingIdRef.current = null
    setDraggingId(null)
    simulationRef.current?.alphaTarget(0).restart()
  }, [])

  useEffect(() => {
    if (!draggingId) return

    const vecs = dragVecs.current

    const handleMove = (ev: PointerEvent) => {
      const node = simNodesRef.current.find((n) => n.id === draggingIdRef.current)
      const controls = controlsRef.current
      if (!node || !controls) return

      vecs.nodePos.set(node.x ?? 0, node.y ?? 0, node.z ?? 0)
      vecs.mouseNDC.set(
        (ev.clientX / window.innerWidth) * 2 - 1,
        -(ev.clientY / window.innerHeight) * 2 + 1,
      )

      const distance = camera.position.distanceTo(vecs.nodePos)
      vecs.dir.set(vecs.mouseNDC.x, vecs.mouseNDC.y, 0.5).unproject(camera)
      vecs.dir.sub(camera.position).normalize()

      vecs.newPos.copy(camera.position).add(vecs.dir.multiplyScalar(distance))
      node.fx = vecs.newPos.x
      node.fy = vecs.newPos.y
      node.fz = vecs.newPos.z

      const g = nodeGroupRefs.current.get(node.id)
      if (g) {
        g.position.set(vecs.newPos.x, vecs.newPos.y, vecs.newPos.z)
      }
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', handleMove)
    }
  }, [draggingId, camera, handlePointerUp])

  const prevSelected = useRef<string | null>(null)
  useEffect(() => {
    if (flyToRafRef.current !== null) {
      cancelAnimationFrame(flyToRafRef.current)
      flyToRafRef.current = null
      if (controlsRef.current) controlsRef.current.enabled = true
    }

    if (!selectedId) {
      prevSelected.current = null
      return
    }

    if (selectedId === prevSelected.current) return

    prevSelected.current = selectedId

    if (!mountSettledRef.current) return

    const node = simNodesRef.current.find((n) => n.id === selectedId)
    const controls = controlsRef.current
    if (!node || !controls) return

    const targetPos = new THREE.Vector3(node.x ?? 0, node.y ?? 0, node.z ?? 0)
    const startPos = camera.position.clone()
    const dir = startPos.clone().sub(targetPos).normalize()
    const idealDist = Math.max(9, (node.val || 1.5) * 5.2)
    const newCamPos = targetPos.clone().add(dir.multiplyScalar(idealDist))

    controls.enabled = false
    const startTarget = controls.target.clone()
    const duration = 920
    const startTime = Date.now()

    const animate = () => {
      const t = Math.min(1, (Date.now() - startTime) / duration)
      const ease = 1 - Math.pow(1 - t, 3)

      camera.position.lerpVectors(startPos, newCamPos, ease)
      controls.target.lerpVectors(startTarget, targetPos, ease)
      controls.update()

      if (t < 1) {
        flyToRafRef.current = requestAnimationFrame(animate)
      } else {
        flyToRafRef.current = null
        controls.enabled = true
      }
    }

    flyToRafRef.current = requestAnimationFrame(animate)

    return () => {
      if (flyToRafRef.current !== null) {
        cancelAnimationFrame(flyToRafRef.current)
        flyToRafRef.current = null
      }
      controls.enabled = true
    }
  }, [selectedId, camera])

  return (
    <>
      <Stars />

      <group ref={groupRef} onClick={handleCanvasClick}>
        <LinkLines
          links={visibleLinks}
          simNodesRef={simNodesRef}
          selectedId={selectedId}
          highlightLinkIds={highlightLinkIds}
          geometryRef={linkGeometryRef}
          highlightGeometryRef={highlightGeometryRef}
        />
        {visibleNodes.map((node) => {
          const isSelected = selectedId === node.id
          const isConnected = connectedSet.has(node.id)
          return (
            <NodeMesh
              key={node.id}
              node={node}
              isSelected={isSelected}
              isConnected={isConnected}
              hasSelection={selectedId != null}
              groupRefs={nodeGroupRefs}
              onNodeClick={handleNodeClick}
              onPointerDown={handlePointerDown}
            />
          )
        })}
      </group>

      <pointLight position={[0, 12, -18]} color="#a5b4fc" intensity={0.4} />

      <OrbitControls
        ref={controlsRef}
        enablePan
        enableZoom
        enableRotate
        minDistance={4}
        maxDistance={100}
        zoomSpeed={0.7}
        rotateSpeed={0.55}
        panSpeed={0.8}
        enableDamping
        dampingFactor={0.12}
      />
    </>
  )
}

// ============================================
// CUSTOM STARFIELD
// Three-layer field: distant tiny dim stars, mid stars, and a few bright
// foreground stars with warm/cool color variation. Soft round sprites via
// shader (no square sprites) with subtle per-star twinkle.
// ============================================
const STAR_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aPhase;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSize;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(-mv.z, 1.0);
    // gentle, per-star twinkle. Long period, small amplitude.
    float tw = 0.78 + 0.22 * sin(uTime * 0.9 + aPhase);
    vAlpha = tw;
    gl_PointSize = aSize * uSize * tw * (260.0 / dist) * uPixelRatio;
    gl_PointSize = clamp(gl_PointSize, 1.2, 90.0);
    gl_Position = projectionMatrix * mv;
  }
`

const STAR_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float d2 = dot(uv, uv);
    if (d2 > 1.0) discard;
    float d = sqrt(d2);
    // soft round star: bright core + falloff halo
    float core = smoothstep(0.55, 0.0, d);
    float halo = smoothstep(1.0, 0.0, d);
    vec3 c = vColor * (0.55 + 0.9 * core);
    float a = (halo * 0.55 + core * 0.45) * vAlpha;
    gl_FragColor = vec4(c, a);
  }
`

// ============================================
// ORB SHADERS — give cores/subs a planet-nebula look instead of flat
// MeshBasicMaterial blobs. Both sphere variants share a vertex shader
// and a fragment shader; uIntensity controls whether the surface reads
// as a glowing star/nebula (cores) or a calmer planet (subs).
// ============================================
const NEBULA_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    vLocal = position;
    gl_Position = projectionMatrix * mv;
  }
`

const NEBULA_FRAG = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uIntensity;   // 1.0 = star/nebula, 0.55 = planet
  uniform float uNoiseScale;
  uniform float uSpeed;

  // Compact 3D hash + value noise + 4-octave fbm.
  float hash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i),                hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)),  hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)),  hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)),  hash(i + vec3(1,1,1)), f.x), f.y),
      f.z
    );
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.55;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p *= 2.05;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    // Fresnel — bright atmosphere rim at the silhouette.
    float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.2);

    // Animated swirling clouds. Sampled in local space so they rotate
    // with the orb (we slowly spin the mesh in useFrame).
    vec3 np = vLocal * uNoiseScale + vec3(uTime * uSpeed, uTime * uSpeed * 0.6, uTime * uSpeed * 1.3);
    float n = fbm(np);
    n = smoothstep(0.25, 0.78, n);

    // Surface mix between a darker "cold" tone and a brighter "hot" tone
    // of the same group color.
    vec3 cold = uColor * 0.32;
    vec3 hot  = uColor * (1.35 + uIntensity * 0.8);
    vec3 surface = mix(cold, hot, n);

    // Atmosphere rim glow.
    vec3 rim = uColor * fres * (1.3 + uIntensity * 1.6);

    // Bright inner emissive core — strong on cores, almost absent on subs.
    float core = pow(max(dot(vNormal, vView), 0.0), 1.6);
    vec3 inner = vec3(1.0, 0.96, 0.9) * (core * uIntensity * 0.55);

    vec3 finalColor = surface + rim + inner;
    gl_FragColor = vec4(finalColor, 1.0);
  }
`

// Crystalline gem material for external orbs — fresnel-driven shimmer
// across the octahedron's facets, no swirling noise. Reads as polished
// crystal rather than gas/plasma.
const GEM_FRAG = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  uniform vec3 uColor;
  uniform float uTime;

  void main() {
    float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 1.7);
    float core = pow(max(dot(vNormal, vView), 0.0), 2.0);

    vec3 deep = uColor * 0.42;
    vec3 bright = uColor * 1.55;
    vec3 surface = mix(deep, bright, core);

    // Pulsing inner glow so the gem feels alive rather than dead crystal.
    float pulse = 0.85 + 0.15 * sin(uTime * 1.4);
    vec3 rim = uColor * fres * 1.8 * pulse;

    // Tiny chromatic shimmer along facet edges using local position.
    float facet = pow(abs(vLocal.x + vLocal.y + vLocal.z) * 0.3, 1.2);
    vec3 shimmer = mix(uColor, vec3(1.0), 0.6) * fres * 0.25 * facet;

    gl_FragColor = vec4(surface + rim + shimmer, 1.0);
  }
`

interface StarLayer {
  count: number
  minR: number
  maxR: number
  sizeMin: number
  sizeMax: number
  flattenY: number
  /** Tint chosen per star: white, cool-blue, warm-yellow, or pure-white near */
  warmth: 'cool' | 'mixed' | 'warm'
}

function buildStarLayer(layer: StarLayer, seedOffset: number) {
  const { count, minR, maxR, sizeMin, sizeMax, flattenY, warmth } = layer
  const positions = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const colors = new Float32Array(count * 3)
  const phases = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    const s = i + seedOffset
    const r = minR + seededRandom(s * 3 + 1) * (maxR - minR)
    const theta = seededRandom(s * 3 + 2) * Math.PI * 2
    const phi = Math.acos(2 * seededRandom(s * 3 + 3) - 1)
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * flattenY
    positions[i * 3 + 2] = r * Math.cos(phi)

    sizes[i] = sizeMin + seededRandom(s * 5 + 7) * (sizeMax - sizeMin)
    phases[i] = seededRandom(s * 11 + 13) * Math.PI * 2

    // Color tint
    const tintRoll = seededRandom(s * 13 + 19)
    let cr: number, cg: number, cb: number
    if (warmth === 'cool') {
      cr = 0.78; cg = 0.84; cb = 0.96
    } else if (warmth === 'mixed') {
      if (tintRoll < 0.25) { cr = 0.82; cg = 0.88; cb = 1.0 }
      else if (tintRoll < 0.45) { cr = 1.0; cg = 0.95; cb = 0.82 }
      else { cr = 0.94; cg = 0.97; cb = 1.0 }
    } else {
      if (tintRoll < 0.3) { cr = 1.0; cg = 0.88; cb = 0.7 }
      else if (tintRoll < 0.55) { cr = 0.78; cg = 0.86; cb = 1.0 }
      else { cr = 1.0; cg = 1.0; cb = 1.0 }
    }
    colors[i * 3] = cr
    colors[i * 3 + 1] = cg
    colors[i * 3 + 2] = cb
  }

  return { positions, sizes, colors, phases }
}

function StarLayerPoints({
  layer,
  seedOffset,
  size,
  rotationSpeed,
}: {
  layer: StarLayer
  seedOffset: number
  size: number
  rotationSpeed: number
}) {
  const data = useMemo(() => buildStarLayer(layer, seedOffset), [layer, seedOffset])
  const pointsRef = useRef<THREE.Points>(null!)
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1

  // Material is owned by component state (lazy init runs once per mount).
  // It's mutable from useFrame because state values are not subject to the
  // "modify after render" lint rule that captures local variables would be.
  const [material] = useState(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: dpr },
          uSize: { value: size },
        },
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
  )

  // Mirror into a ref so useFrame can mutate uniforms without tripping the
  // react-hooks/immutability rule that fires on captured render values.
  const materialRef = useRef<THREE.ShaderMaterial | null>(null)
  useLayoutEffect(() => {
    materialRef.current = material
    return () => {
      material.dispose()
      materialRef.current = null
    }
  }, [material])

  useFrame(({ clock }) => {
    const mat = materialRef.current
    if (mat) {
      mat.uniforms.uTime.value = clock.elapsedTime
    }
    const pts = pointsRef.current
    if (pts) {
      pts.rotation.y = clock.elapsedTime * rotationSpeed
    }
  })

  return (
    <points ref={pointsRef} material={material} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[data.positions, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[data.sizes, 1]} />
        <bufferAttribute attach="attributes-aColor" args={[data.colors, 3]} />
        <bufferAttribute attach="attributes-aPhase" args={[data.phases, 1]} />
      </bufferGeometry>
    </points>
  )
}

function Stars() {
  const mobile = useIsMobile()
  // Three depth layers — far, mid, near — each rotating at a slightly
  // different speed for subtle parallax.
  const farLayer: StarLayer = useMemo(
    () => ({
      count: mobile ? 320 : 560,
      minR: 95,
      maxR: 150,
      sizeMin: 0.5,
      sizeMax: 1.1,
      flattenY: 0.85,
      warmth: 'cool',
    }),
    [mobile],
  )
  const midLayer: StarLayer = useMemo(
    () => ({
      count: mobile ? 140 : 260,
      minR: 55,
      maxR: 90,
      sizeMin: 0.9,
      sizeMax: 1.7,
      flattenY: 0.75,
      warmth: 'mixed',
    }),
    [mobile],
  )
  const nearLayer: StarLayer = useMemo(
    () => ({
      count: mobile ? 32 : 60,
      minR: 38,
      maxR: 55,
      sizeMin: 1.6,
      sizeMax: 2.8,
      flattenY: 0.6,
      warmth: 'warm',
    }),
    [mobile],
  )

  return (
    <>
      <StarLayerPoints layer={farLayer} seedOffset={101} size={1.0} rotationSpeed={0.0004} />
      <StarLayerPoints layer={midLayer} seedOffset={977} size={1.15} rotationSpeed={0.0009} />
      <StarLayerPoints layer={nearLayer} seedOffset={4201} size={1.35} rotationSpeed={0.0015} />
    </>
  )
}

// ============================================
// PUBLIC COMPONENT
// ============================================
export default function ConstellationCanvas(props: Props) {
  const isMobile = useIsMobile()

  return (
    <div
      id="constellation"
      className="select-none"
      role="img"
      aria-label="Interactive 3D constellation of Elon Musk companies and connections"
      aria-describedby="constellation-instructions"
      style={{ touchAction: 'none' }}
    >
      <div
        id="constellation-instructions"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        Drag to rotate the view, scroll or pinch to zoom, and click nodes to explore
        connections. Press Escape to deselect.
      </div>
      <Canvas
        camera={{ position: [18, 12, 38], fov: 50, near: 0.5, far: 320 }}
        style={{ background: 'transparent' }}
        dpr={isMobile ? [1, 1.5] : undefined}
        gl={{
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance',
          toneMapping: THREE.NoToneMapping,
        }}
      >
        <color attach="background" args={['#000000']} />
        <fog attach="fog" args={['#000000', 80, 170]} />

        <Scene {...props} />

        {!isMobile && (
          <EffectComposer>
            <Bloom
              intensity={1.1}
              luminanceThreshold={0.18}
              luminanceSmoothing={0.85}
              radius={0.68}
            />
          </EffectComposer>
        )}
      </Canvas>
    </div>
  )
}
