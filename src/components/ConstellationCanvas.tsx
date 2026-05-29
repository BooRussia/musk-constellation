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
  /**
   * Fraction of canvas-bottom currently covered by an overlay (e.g. the
   * mobile bottom sheet). 0 = canvas fully visible. 0.55 = bottom 55%
   * covered. Drives a camera framing offset so the focused orb is
   * centered in the *visible* portion of the canvas rather than the
   * geometric center, and smoothly recomposes when the sheet animates.
   */
  bottomOverlayFraction?: number
  /** WEB toggle — when true, every link line renders bright regardless
   *  of selection, so the full company web is visible at a glance. */
  showAllWeb?: boolean
  /** PULSE toggle — when true, the animated flow particles run on
   *  every link, not just the focused node's web. */
  showAllPulse?: boolean
  /** Monotonically-increasing counter. Each increment triggers a
   *  smooth camera animation back to the initial fitted "home" view. */
  resetSignal?: number
  /** Timeline mode cursor (float year). When non-null, each NodeMesh
   *  scales its render size by clamp((timelineYear - foundedYear) /
   *  GROWTH_DURATION, 0, 1) so orbs grow in smoothly as the user
   *  scrubs past each entity's founding year. null = Timeline off. */
  timelineYear?: number | null
  /** Per-company focus filter. Nodes whose group is NOT in this set
   *  are hidden, unless they're directly linked to a node in an
   *  enabled group (adjacency rule — keeps the focused company's
   *  partners visible). undefined = no filtering. */
  enabledGroups?: Set<Node['group']>
  /** Camera focus target id for the soft-follow lerp. Used by
   *  Timeline mode to glide the camera toward each event's company
   *  as the cursor crosses event years. Differs from selection-
   *  driven fly-to: doesn't disable OrbitControls, doesn't pin the
   *  node, doesn't open the details panel — purely a damped track
   *  that can be smoothly redirected as new events fire. null =
   *  no follow. */
  cameraFocusId?: string | null
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
  /** Live float year for Timeline mode. Read every frame so orbs
   *  scale + fade in continuously as the cursor scrubs past their
   *  foundedYear. null = Timeline off, full size + opacity. */
  timelineYearRef: React.RefObject<number | null>
}

/** Years between an orb's foundedYear and "fully grown". */
const NODE_GROWTH_DURATION_YEARS = 1.2

const NodeMesh = memo(function NodeMesh({
  node,
  isSelected,
  isConnected,
  hasSelection,
  groupRefs,
  onNodeClick,
  onPointerDown,
  timelineYearRef,
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

    // Timeline grow-in: when Timeline mode is active, scale this orb
    // from a tiny seed (5%) up to full size over GROWTH_DURATION_YEARS
    // years past its foundedYear. Nodes without a foundedYear (or with
    // Timeline off) always render at full size. Reading from a ref
    // means changing the year doesn't cause a re-render of every
    // memo'd NodeMesh — only the per-frame scale write happens.
    const ty = timelineYearRef.current
    let birthScale = 1
    let birthLabelMult = 1
    if (ty !== null && typeof node.foundedYear === 'number') {
      const yearsAlive = ty - node.foundedYear
      // Smoothstep gives a soft ease-in/out so orbs don't snap awake.
      const t = Math.max(0, Math.min(1, yearsAlive / NODE_GROWTH_DURATION_YEARS))
      const eased = t * t * (3 - 2 * t)
      birthScale = 0.05 + eased * 0.95
      birthLabelMult = eased
    }
    group.scale.setScalar(birthScale)

    let target: number

    if (!hasSelection) {
      // Home state. Core company orbs always show their name so a first-
      // time viewer can identify Tesla / SpaceX / xAI / etc. at a glance.
      // Sub-orbs and externals stay hidden until hover so the field
      // doesn't read as label-soup. Hover always wins.
      if (isHovered) {
        target = 1
      } else if (node.type === 'core') {
        target = 0.8
      } else {
        target = 0
      }
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

    el.style.opacity = (target * birthLabelMult).toFixed(3)
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
  highlightGeometryRef: React.MutableRefObject<THREE.BufferGeometry | null>
  /** When true, all links render bright regardless of selection. */
  showAllWeb?: boolean
  /** When true, every link is treated as highlighted for the flow
   *  particle pass (and reflected in its line opacity). */
  showAllPulse?: boolean
}

const LinkLines = memo(function LinkLines({
  links,
  simNodesRef,
  selectedId,
  highlightLinkIds,
  geometryRef,
  highlightGeometryRef,
  showAllWeb = false,
  showAllPulse = false,
}: LinkLinesProps) {
  const { positions, colors, highlightIndices, flowIndices } = useMemo(() => {
    const pos = new Float32Array(links.length * 6)
    const col = new Float32Array(links.length * 6)
    const hi: number[] = []   // white overlay (focus only)
    const fi: number[] = []   // animated flow particles

    links.forEach((link, i) => {
      const isFocusHighlight =
        highlightLinkIds.has(`${link.source}-${link.target}`) ||
        highlightLinkIds.has(`${link.target}-${link.source}`)

      // Direction-aware gradient: source node's group color at the source
      // end, target node's group color at the target end.
      const srcNode = getNodeById(link.source)
      const tgtNode = getNodeById(link.target)
      const srcRgb = hexToRgb(srcNode ? GROUP_COLORS[srcNode.group] : (LINK_COLORS[link.type] || '#888888'))
      const tgtRgb = hexToRgb(tgtNode ? GROUP_COLORS[tgtNode.group] : (LINK_COLORS[link.type] || '#888888'))

      // Opacity priority:
      //   1. focus-highlighted (selected node's web)    → 0.95 (loudest)
      //   2. WEB toggle on                              → 0.78 (persistent bright)
      //   3. PULSE on (without WEB)                     → 0 (particles do the talking)
      //   4. selection active but this link unrelated   → 0.18 (dimmed away)
      //   5. default home state                         → 0.5
      let opacity: number
      if (isFocusHighlight) opacity = 0.95
      else if (showAllWeb) opacity = 0.78
      else if (showAllPulse) opacity = 0
      else if (selectedId) opacity = 0.18
      else opacity = 0.5

      const srcMul = opacity * 1.0
      const tgtMul = opacity * 0.55
      const base = i * 6
      col[base + 0] = (srcRgb[0] / 255) * srcMul
      col[base + 1] = (srcRgb[1] / 255) * srcMul
      col[base + 2] = (srcRgb[2] / 255) * srcMul
      col[base + 3] = (tgtRgb[0] / 255) * tgtMul
      col[base + 4] = (tgtRgb[1] / 255) * tgtMul
      col[base + 5] = (tgtRgb[2] / 255) * tgtMul

      if (isFocusHighlight) hi.push(i)
      if (isFocusHighlight || showAllPulse) fi.push(i)
    })

    return { positions: pos, colors: col, highlightIndices: hi, flowIndices: fi }
  }, [links, highlightLinkIds, selectedId, showAllWeb, showAllPulse])

  const highlightPositions = useMemo(
    () => new Float32Array(highlightIndices.length * 6),
    [highlightIndices.length],
  )

  useEffect(() => {
    geometryRef.current = null
    highlightGeometryRef.current = null
  }, [geometryRef, highlightGeometryRef, links])

  // R3F's <bufferAttribute args={[colors, 3]} /> only reads `args` at
  // construction. When useMemo recomputes `colors` because WEB / PULSE /
  // selection state changed, the JSX gets a new array reference but the
  // GPU buffer is never re-uploaded — so toggling WEB or PULSE looked
  // stuck. Fix: each time `colors` changes, copy the new values into the
  // existing attached buffer and mark it for upload.
  useEffect(() => {
    const geo = geometryRef.current
    if (!geo) return
    const colorAttr = geo.getAttribute('color') as THREE.BufferAttribute | undefined
    if (!colorAttr) return
    const arr = colorAttr.array as Float32Array
    if (arr.length !== colors.length) return
    arr.set(colors)
    colorAttr.needsUpdate = true
  }, [colors, geometryRef])

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
        highlightIndices={flowIndices}
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
// Bumped to cover every visible link when the PULSE toggle is on
// (53 documented links; ~40-50 visible at peak expansion).
const FLOW_MAX_LINKS = 64
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
  bottomOverlayFraction = 0,
  showAllWeb = false,
  showAllPulse = false,
  resetSignal = 0,
  timelineYear = null,
  enabledGroups,
  cameraFocusId = null,
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

  // Mirror the timelineYear prop into a ref so NodeMesh's per-frame
  // size animation can read it without forcing every memo'd orb to
  // re-render every time the year ticks (which during auto-play
  // happens 60×/sec). useEffect (not direct write) satisfies the
  // react-hooks/refs lint rule.
  const timelineYearRef = useRef<number | null>(timelineYear)
  useEffect(() => {
    timelineYearRef.current = timelineYear
  }, [timelineYear])

  // Soft camera follow — used by Timeline mode to glide the camera
  // toward each event's primary node as the cursor crosses event
  // years. Distinct from the explicit fly-to (which disables
  // controls + pins the node) — follow is a continuous damped lerp
  // that gracefully redirects when the target changes mid-flight.
  const followTargetRef = useRef<{ pos: THREE.Vector3; lookAt: THREE.Vector3 } | null>(null)
  const followFromIdRef = useRef<string | null>(null)

  // When cameraFocusId changes (and isn't already the active follow
  // target), recompute the desired camera position + lookAt. The
  // useFrame loop lerps from current state toward this target each
  // frame; setting a fresh target mid-lerp gracefully redirects.
  useEffect(() => {
    if (!cameraFocusId) {
      followTargetRef.current = null
      followFromIdRef.current = null
      return
    }
    if (cameraFocusId === followFromIdRef.current) return
    followFromIdRef.current = cameraFocusId
    const node = simNodesRef.current.find((n) => n.id === cameraFocusId)
    const controls = controlsRef.current
    if (!node || !controls) return
    const targetPos = new THREE.Vector3(node.x ?? 0, node.y ?? 0, node.z ?? 0)
    // Keep the current viewing angle — only the position+lookAt
    // change. Distance is slightly looser than direct selection
    // (1.4×) so the user sees the orb plus context, not extreme
    // close-up.
    const currentDir = camera.position.clone().sub(controls.target).normalize()
    const idealDist = Math.max(11, (node.val || 1.5) * 6.4)
    const newCamPos = targetPos.clone().add(currentDir.multiplyScalar(idealDist))
    followTargetRef.current = { pos: newCamPos, lookAt: targetPos }
  }, [cameraFocusId, camera])

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
    () => getVisibleNodes(expandedIds, undefined, enabledGroups),
    [expandedIds, enabledGroups],
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

  // On canvas resize: keep camera aspect ratio in sync, but DON'T refit
  // the camera position. Re-fitting on every sidebar/panel toggle made
  // the view jump around violently. The user's chosen camera position
  // (whether from initial fit, manual orbit, or a node fly-to) should
  // survive layout shifts; only the projection matrix updates.
  const cameraRef = useRef<THREE.Camera | null>(null)
  useLayoutEffect(() => {
    cameraRef.current = camera
  }, [camera])
  useEffect(() => {
    const cam = cameraRef.current as THREE.PerspectiveCamera | null
    if (!cam) return
    cam.aspect = size.width / size.height
    cam.updateProjectionMatrix()
  }, [size.width, size.height])

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

    // Soft camera follow (Timeline mode). Damped per-frame lerp at
    // a fixed rate per frame, so however quickly cameraFocusId
    // changes (e.g. in 2024 where 9 events fire across ~2 seconds),
    // the camera transitions smoothly without jitter. Skipped when
    // the explicit fly-to is active so the two systems don't fight.
    const follow = followTargetRef.current
    const controls = controlsRef.current
    if (follow && controls && flyToRafRef.current === null) {
      const k = 0.045 // smoothing factor — ~50% convergence per ~150ms at 60fps
      // Track the moving node — re-read its sim position each frame
      // so the camera doesn't lock on a stale spot if the sim is
      // still settling. Direction from current camera is preserved
      // so user-controlled rotation isn't snapped away.
      const node = simNodesRef.current.find((n) => n.id === followFromIdRef.current)
      if (node) {
        const lookAt = follow.lookAt.set(node.x ?? 0, node.y ?? 0, node.z ?? 0)
        const dir = camera.position.clone().sub(controls.target).normalize()
        const idealDist = Math.max(11, (node.val || 1.5) * 6.4)
        follow.pos.copy(lookAt).add(dir.multiplyScalar(idealDist))
      }
      camera.position.lerp(follow.pos, k)
      controls.target.lerp(follow.lookAt, k)
      // controls.update() is called by OrbitControls' own damping
      // loop; nudging position+target is enough.
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

  // Track the pointer-down origin AND whether we've committed to a drag
  // yet. A pure click (no movement past threshold) should NOT pin the
  // node or restart the sim — earlier, every click jolted the
  // constellation because handlePointerDown immediately set fx/fy/fz
  // and bumped alphaTarget.
  const dragStartScreenRef = useRef({ x: 0, y: 0 })
  const dragCommittedRef = useRef(false)
  const DRAG_THRESHOLD_PX = 4

  const handlePointerDown = useCallback((id: string, e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    draggingIdRef.current = id
    setDraggingId(id)
    dragCommittedRef.current = false
    dragStartScreenRef.current.x = e.clientX
    dragStartScreenRef.current.y = e.clientY
    // No pin, no alpha bump yet — those happen lazily in handleMove
    // only if the pointer actually moves past DRAG_THRESHOLD_PX.
  }, [])

  const handlePointerUp = useCallback(() => {
    const dragId = draggingIdRef.current
    if (!dragId) return
    // Only undo the pin + alpha if we actually committed to a drag.
    if (dragCommittedRef.current) {
      const node = simNodesRef.current.find((n) => n.id === dragId)
      if (node) {
        node.fx = null
        node.fy = null
        node.fz = null
      }
      simulationRef.current?.alphaTarget(0).restart()
    }
    draggingIdRef.current = null
    dragCommittedRef.current = false
    setDraggingId(null)
  }, [])

  useEffect(() => {
    if (!draggingId) return

    const vecs = dragVecs.current

    const handleMove = (ev: PointerEvent) => {
      const node = simNodesRef.current.find((n) => n.id === draggingIdRef.current)
      const controls = controlsRef.current
      if (!node || !controls) return

      // Defer committing to "this is a drag" until the pointer has
      // actually moved past the threshold. Until then, do nothing — a
      // click that lifts at the same pixel will skip this branch
      // entirely and fall through to handleNodeClick → onSelect.
      if (!dragCommittedRef.current) {
        const dx = ev.clientX - dragStartScreenRef.current.x
        const dy = ev.clientY - dragStartScreenRef.current.y
        if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return
        dragCommittedRef.current = true
        // First real drag motion — pin the node + nudge the sim awake.
        node.fx = node.x ?? 0
        node.fy = node.y ?? 0
        node.fz = node.z ?? 0
        simulationRef.current?.alphaTarget(0.25).restart()
      }

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
  // Track which node is currently pinned so we can release it on
  // deselect / when a different node becomes the focus. Pinning a node's
  // fx/fy/fz freezes it in place against the d3 simulation, so the
  // camera fly-to lands on a stable target and the node doesn't drift
  // out from under the cursor afterwards.
  const pinnedNodeRef = useRef<string | null>(null)
  const releasePinned = useCallback(() => {
    const id = pinnedNodeRef.current
    if (!id) return
    const node = simNodesRef.current.find((n) => n.id === id)
    if (node) {
      node.fx = null
      node.fy = null
      node.fz = null
    }
    pinnedNodeRef.current = null
  }, [])

  useEffect(() => {
    if (flyToRafRef.current !== null) {
      cancelAnimationFrame(flyToRafRef.current)
      flyToRafRef.current = null
      if (controlsRef.current) controlsRef.current.enabled = true
    }

    if (!selectedId) {
      prevSelected.current = null
      releasePinned()
      return
    }

    if (selectedId === prevSelected.current) return

    // New focus — release any previously pinned node before pinning this one.
    releasePinned()
    prevSelected.current = selectedId

    if (!mountSettledRef.current) return

    const node = simNodesRef.current.find((n) => n.id === selectedId)
    const controls = controlsRef.current
    if (!node || !controls) return

    // Pin the node so the d3 sim stops nudging it. Camera fly-to lands
    // on a stable target, and the node stays put under cursor + label.
    node.fx = node.x ?? 0
    node.fy = node.y ?? 0
    node.fz = node.z ?? 0
    pinnedNodeRef.current = selectedId

    const targetPos = new THREE.Vector3(node.x ?? 0, node.y ?? 0, node.z ?? 0)
    const startPos = camera.position.clone()
    const dir = startPos.clone().sub(targetPos).normalize()
    const idealDist = Math.max(9, (node.val || 1.5) * 5.2)
    const newCamPos = targetPos.clone().add(dir.multiplyScalar(idealDist))

    // Drop any queued WASD/QE/arrow keys so they don't snap the camera
    // off-target the moment the fly-to completes.
    keysHeld.current.clear()

    controls.enabled = false
    const startTarget = controls.target.clone()
    const duration = 1100
    const startTime = Date.now()

    const animate = () => {
      const t = Math.min(1, (Date.now() - startTime) / duration)
      // Ease-in-out cubic — soft acceleration AND deceleration for a
      // cinematic glide instead of a snap-then-coast feel.
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

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
  }, [selectedId, camera, releasePinned])

  // Unmount cleanup — release any node we pinned so it can re-enter the
  // simulation if the component remounts.
  useEffect(() => {
    return () => {
      releasePinned()
    }
  }, [releasePinned])

  // RESET button: animate the camera back to the initial fitted "home"
  // view. Each increment of resetSignal triggers a fresh ~700ms lerp
  // from wherever the user has dragged the camera to the position that
  // fitCameraToNodes would place it at on first load.
  const resetRafRef = useRef<number | null>(null)
  useEffect(() => {
    if (resetSignal === 0) return // initial mount — skip
    const controls = controlsRef.current
    const cam = cameraRef.current as THREE.PerspectiveCamera | null
    if (!controls || !cam) return
    if (simNodesRef.current.length === 0) return

    // Cancel any in-flight fly-to or reset animation so we don't fight.
    if (flyToRafRef.current !== null) {
      cancelAnimationFrame(flyToRafRef.current)
      flyToRafRef.current = null
    }
    if (resetRafRef.current !== null) {
      cancelAnimationFrame(resetRafRef.current)
      resetRafRef.current = null
    }
    releasePinned()

    // Compute the destination by running fitCameraToNodes against
    // throwaway camera + controls clones, then animating the real ones
    // to that destination.
    const tmpCam = cam.clone() as THREE.PerspectiveCamera
    tmpCam.aspect = cam.aspect
    tmpCam.updateProjectionMatrix()
    const tmpControls = {
      target: new THREE.Vector3(),
      update: () => {},
    } as unknown as OrbitControlsImpl
    fitCameraToNodes(tmpCam, tmpControls, simNodesRef.current, fitVecs.current)

    // Drop any queued WASD keystrokes so they don't snap the camera
    // off-home the instant the reset animation completes.
    keysHeld.current.clear()

    const startPos = cam.position.clone()
    const startTarget = controls.target.clone()
    const endPos = tmpCam.position.clone()
    const endTarget = tmpControls.target.clone()

    controls.enabled = false
    const duration = 720
    const startTime = Date.now()
    const step = () => {
      const t = Math.min(1, (Date.now() - startTime) / duration)
      const ease = 1 - Math.pow(1 - t, 3)
      cam.position.lerpVectors(startPos, endPos, ease)
      controls.target.lerpVectors(startTarget, endTarget, ease)
      controls.update()
      if (t < 1) {
        resetRafRef.current = requestAnimationFrame(step)
      } else {
        resetRafRef.current = null
        controls.enabled = true
        // The camera-reframe useFrame will smoothly re-converge on its
        // next tick — no manual offset reset needed.
      }
    }
    resetRafRef.current = requestAnimationFrame(step)

    return () => {
      if (resetRafRef.current !== null) {
        cancelAnimationFrame(resetRafRef.current)
        resetRafRef.current = null
      }
      controls.enabled = true
    }
  }, [resetSignal, releasePinned])

  // Smooth camera reframe whenever the bottom overlay (mobile sheet)
  // covers part of the canvas — shifts the controls.target down so the
  // focused orb stays centered in the *visible* canvas instead of the
  // geometric center. Also reads the live --sheet-drag CSS variable
  // each frame so the camera animates in lockstep with a finger drag.
  const liveOverlayRef = useRef(bottomOverlayFraction)
  useLayoutEffect(() => {
    liveOverlayRef.current = bottomOverlayFraction
  }, [bottomOverlayFraction])
  const lastTargetYOffset = useRef(0)
  // Cache the panel DOM ref so we don't run document.querySelector 60
  // times a second. On Mac Chromium/Arc that per-frame DOM walk has
  // been observed to thrash style invalidation when the panel has CSS
  // variables that change.
  const panelDomRef = useRef<HTMLElement | null>(null)
  const panelLookupAttempts = useRef(0)

  useFrame(() => {
    const controls = controlsRef.current
    const cam = cameraRef.current as THREE.PerspectiveCamera | null
    if (!controls || !cam) return
    // Don't fight the fly-to or reset animations while they're running —
    // the camera-reframe useFrame will resume easing toward the right
    // offset once those finish.
    if (flyToRafRef.current !== null) return
    if (resetRafRef.current !== null) return

    // Skip the overlay reframe entirely on desktop (where bottomOverlayFraction
    // is permanently 0). This cuts the per-frame DOM read + math out of
    // the hot path for everyone except mobile users with the sheet open.
    if (liveOverlayRef.current === 0 && lastTargetYOffset.current === 0) {
      return
    }

    // Drag-aware effective overlay. As user drags the sheet down, its
    // --sheet-drag CSS var goes 0→1 and the effective overlay shrinks
    // toward 0 — the camera smoothly re-centers in real time. Resolve
    // the panel element once, then re-resolve if our cached ref drops
    // out of the DOM (e.g. AnimatePresence remount).
    let dragProgress = 0
    if (typeof document !== 'undefined') {
      let panel = panelDomRef.current
      if (!panel || !panel.isConnected) {
        // Throttle lookups so we don't spam querySelector when there's
        // genuinely no panel mounted.
        if ((panelLookupAttempts.current++ & 0x1f) === 0) {
          panel = document.querySelector<HTMLElement>('.details-panel')
          panelDomRef.current = panel
        }
      }
      if (panel) {
        const v = parseFloat(panel.style.getPropertyValue('--sheet-drag') || '0')
        if (!Number.isNaN(v)) dragProgress = Math.min(1, Math.max(0, v))
      }
    }
    const effectiveOverlay = liveOverlayRef.current * (1 - dragProgress)

    const node = selectedId
      ? simNodesRef.current.find((n) => n.id === selectedId)
      : null
    const baseY = node ? node.y ?? 0 : 0

    // Visible world height at the current camera-to-target distance.
    const dist = cam.position.distanceTo(controls.target)
    const fovRad = (cam.fov * Math.PI) / 180
    const visibleWorldHeight = 2 * dist * Math.tan(fovRad / 2)
    // Push the look-point DOWN so the focused orb floats UP into the
    // visible (un-overlaid) canvas area.
    const desiredOffset = -effectiveOverlay * 0.5 * visibleWorldHeight

    // Critically-damped ease toward desiredOffset (~150ms time constant
    // at 60fps with k=0.18). Feels snappy but never overshoots.
    lastTargetYOffset.current += (desiredOffset - lastTargetYOffset.current) * 0.18

    if (Math.abs(lastTargetYOffset.current - (controls.target.y - baseY)) > 0.001) {
      controls.target.y = baseY + lastTargetYOffset.current
      controls.update()
    }
  })

  // ============================================
  // KEYBOARD ORBIT (WASD + QE)
  //   W / S       — orbit polar (move camera up / down around target)
  //   A / D       — orbit azimuthally (left / right) around target
  //   Q / E       — dolly camera away / toward target (zoom out / in)
  //   Arrow keys  — pan target left/right/up/down (in camera plane)
  // Smooth per-frame easing with delta-time scaling. Velocities ramp
  // up and decay so a tapped key produces a soft glide instead of a
  // jerky step.
  // ============================================
  const keysHeld = useRef<Set<string>>(new Set())
  const orbitVel = useRef({ azimuth: 0, polar: 0, dolly: 0, panX: 0, panY: 0 })
  const sphericalRef = useRef(new THREE.Spherical())
  const offsetVec = useRef(new THREE.Vector3())
  const panVec = useRef(new THREE.Vector3())
  const tmpVec = useRef(new THREE.Vector3())

  useEffect(() => {
    const isEditable = (el: EventTarget | null): boolean => {
      if (!el || !(el instanceof HTMLElement)) return false
      const tag = el.tagName
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el.isContentEditable
      )
    }
    const onDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isEditable(document.activeElement)) return
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (
        k === 'w' || k === 'a' || k === 's' || k === 'd' ||
        k === 'q' || k === 'e' ||
        k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight'
      ) {
        keysHeld.current.add(k)
        e.preventDefault()
      }
    }
    const onUp = (e: KeyboardEvent) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      keysHeld.current.delete(k)
    }
    const onBlur = () => keysHeld.current.clear()
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  useFrame((_, delta) => {
    const controls = controlsRef.current
    const cam = cameraRef.current as THREE.PerspectiveCamera | null
    if (!controls || !cam) return
    if (flyToRafRef.current !== null) return

    // Clamp delta so a long pause / tab-switch doesn't snap the camera.
    const dt = Math.min(delta, 0.05)

    // Target accelerations from currently-held keys.
    const held = keysHeld.current
    const accel = 12 // 1/s — how fast velocity ramps to target
    const decay = 8 // 1/s — how fast velocity decays when no key held
    const targetAz = (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0)
    const targetPol = (held.has('w') ? 1 : 0) - (held.has('s') ? 1 : 0)
    const targetDolly = (held.has('q') ? 1 : 0) - (held.has('e') ? 1 : 0)
    const targetPanX = (held.has('ArrowLeft') ? 1 : 0) - (held.has('ArrowRight') ? 1 : 0)
    const targetPanY = (held.has('ArrowUp') ? 1 : 0) - (held.has('ArrowDown') ? 1 : 0)

    const ease = (v: number, target: number) => {
      const k = target === 0 ? decay : accel
      return v + (target - v) * Math.min(1, dt * k)
    }
    const v = orbitVel.current
    v.azimuth = ease(v.azimuth, targetAz)
    v.polar = ease(v.polar, targetPol)
    v.dolly = ease(v.dolly, targetDolly)
    v.panX = ease(v.panX, targetPanX)
    v.panY = ease(v.panY, targetPanY)

    const anyMotion =
      Math.abs(v.azimuth) > 0.001 ||
      Math.abs(v.polar) > 0.001 ||
      Math.abs(v.dolly) > 0.001 ||
      Math.abs(v.panX) > 0.001 ||
      Math.abs(v.panY) > 0.001
    if (!anyMotion) return

    // Per-second motion rates.
    const orbitRate = 1.6 // rad/s at full velocity
    const dollyRate = 2.2 // radius scales by up to 2.2× per second at full velocity
    const panRate = 0.55 // fraction of distance to target per second

    // Apply azimuth + polar + dolly via spherical coords around target.
    offsetVec.current.subVectors(cam.position, controls.target)
    sphericalRef.current.setFromVector3(offsetVec.current)
    sphericalRef.current.theta += v.azimuth * orbitRate * dt
    sphericalRef.current.phi -= v.polar * orbitRate * dt
    // Clamp polar so we don't flip past the poles.
    sphericalRef.current.phi = Math.max(0.08, Math.min(Math.PI - 0.08, sphericalRef.current.phi))
    sphericalRef.current.radius *= Math.pow(dollyRate, v.dolly * dt)
    sphericalRef.current.radius = Math.max(controls.minDistance, Math.min(controls.maxDistance, sphericalRef.current.radius))
    offsetVec.current.setFromSpherical(sphericalRef.current)
    cam.position.copy(controls.target).add(offsetVec.current)

    // Pan: move both camera + target sideways/up in screen-aligned plane.
    if (Math.abs(v.panX) > 0.001 || Math.abs(v.panY) > 0.001) {
      const dist = offsetVec.current.length()
      const panAmount = dist * panRate * dt
      // Camera-right vector in world space.
      tmpVec.current.set(1, 0, 0).applyQuaternion(cam.quaternion)
      panVec.current.copy(tmpVec.current).multiplyScalar(v.panX * panAmount)
      // Camera-up vector.
      tmpVec.current.set(0, 1, 0).applyQuaternion(cam.quaternion)
      panVec.current.addScaledVector(tmpVec.current, v.panY * panAmount)
      cam.position.add(panVec.current)
      controls.target.add(panVec.current)
    }

    controls.update()
  })

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
          showAllWeb={showAllWeb}
          showAllPulse={showAllPulse}
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
              timelineYearRef={timelineYearRef}
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
        /* Lower damping factor = more inertia / glide after the
           user releases the mouse. 0.08 feels weighty + cinematic
           without becoming sluggish. */
        dampingFactor={0.08}
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
// Explicit `precision mediump float;` in the fragment shaders. WebGL2's
// default for fragments is highp, which on macOS Chromium → ANGLE →
// Metal can corrupt textures or fall back to software paths when many
// materials run simultaneously. mediump renders identically to highp
// for this dynamic range while staying inside Metal's fast path.

const NEBULA_VERT = /* glsl */ `
  precision mediump float;
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
  precision mediump float;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uIntensity;   // 1.0 = star/nebula, 0.55 = planet
  uniform float uNoiseScale;
  uniform float uSpeed;

  // Compact 3D hash + value noise. 2 octaves of fbm (was 4) — the visual
  // difference at orb scale is tiny but it halves the fragment-shader
  // workload, which is the difference between "renders" and "Metal
  // crashes the context" on some macOS hybrid-GPU setups.
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
    float v = noise(p) * 0.65;
    v += noise(p * 2.1) * 0.35;
    return v;
  }

  void main() {
    float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.2);

    vec3 np = vLocal * uNoiseScale + vec3(uTime * uSpeed, uTime * uSpeed * 0.6, uTime * uSpeed * 1.3);
    float n = smoothstep(0.25, 0.78, fbm(np));

    vec3 cold = uColor * 0.32;
    vec3 hot  = uColor * (1.35 + uIntensity * 0.8);
    vec3 surface = mix(cold, hot, n);

    vec3 rim = uColor * fres * (1.3 + uIntensity * 1.6);

    float core = pow(max(dot(vNormal, vView), 0.0), 1.6);
    vec3 inner = vec3(1.0, 0.96, 0.9) * (core * uIntensity * 0.55);

    // Clamp to a safe range before output — keeps Bloom thresholds
    // stable and prevents NaN/Inf propagation from accumulating noise.
    vec3 finalColor = clamp(surface + rim + inner, 0.0, 4.0);
    gl_FragColor = vec4(finalColor, 1.0);
  }
`

// Crystalline gem material for external orbs — fresnel-driven shimmer
// across the octahedron's facets, no swirling noise.
const GEM_FRAG = /* glsl */ `
  precision mediump float;
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

    float pulse = 0.85 + 0.15 * sin(uTime * 1.4);
    vec3 rim = uColor * fres * 1.8 * pulse;

    float facet = pow(abs(vLocal.x + vLocal.y + vLocal.z) * 0.3, 1.2);
    vec3 shimmer = mix(uColor, vec3(1.0), 0.6) * fres * 0.25 * facet;

    gl_FragColor = vec4(clamp(surface + rim + shimmer, 0.0, 4.0), 1.0);
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
        // Cap DPR at 2 even on 3x retina / 4K displays. With ~30 unique
        // ShaderMaterials in flight, rendering at 3x DPR triples the
        // fragment-shader work and can push privacy-hardened browsers
        // into texture corruption or context loss.
        dpr={isMobile ? [1, 1.5] : [1, 2]}
        gl={{
          alpha: true,
          antialias: true,
          // 'default' (was 'high-performance') — on hybrid-GPU laptops and
          // privacy-hardened browsers (Brave shields, Arc, some Edge
          // configs) 'high-performance' can trigger driver swaps that
          // either fail outright or hand back a degraded context, causing
          // the texture-glitch-then-black behaviour. 'default' lets the
          // browser pick whatever it can deliver reliably.
          powerPreference: 'default',
          // Don't refuse to render on systems flagged as low-performance —
          // we'd rather render slowly than show a black canvas.
          failIfMajorPerformanceCaveat: false,
          toneMapping: THREE.NoToneMapping,
        }}
        onCreated={({ gl }) => {
          const canvas = gl.domElement
          // Surface renderer details so we can diagnose user reports of
          // "all black" / glitching textures. Most often this points at a
          // privacy shield, hardware blocklist, or fallback software
          // renderer.
          try {
            const rendererCtx = gl.getContext()
            const debugInfo = rendererCtx.getExtension('WEBGL_debug_renderer_info')
            const vendor = debugInfo
              ? rendererCtx.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
              : rendererCtx.getParameter(rendererCtx.VENDOR)
            const renderer = debugInfo
              ? rendererCtx.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
              : rendererCtx.getParameter(rendererCtx.RENDERER)
            console.info('[Constellation] WebGL:', vendor, '·', renderer)
          } catch {
            /* ignore — some browsers block this info entirely */
          }

          // Listen for context loss (driver crash, GPU pressure, Chrome
          // throttling). preventDefault tells the browser we want a chance
          // to recover; without it the canvas stays black permanently.
          const onLost = (e: Event) => {
            e.preventDefault()
            console.warn('[Constellation] WebGL context lost — attempting recovery.')
          }
          const onRestored = () => {
            console.info('[Constellation] WebGL context restored.')
          }
          canvas.addEventListener('webglcontextlost', onLost, false)
          canvas.addEventListener('webglcontextrestored', onRestored, false)
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
