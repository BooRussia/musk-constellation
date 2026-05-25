import { useRef, useEffect, useMemo, useCallback, memo, useState } from 'react'
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

function hashLabelOffset(id: string): [number, number] {
  const angle = ((hashFromId(id) >>> 0) / 4294967296) * Math.PI * 2
  return [Math.cos(angle), Math.sin(angle)]
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
  padding = 1.35,
) {
  if (nodes.length === 0) return

  const box = new THREE.Box3()
  for (const n of nodes) {
    vecRefs.point.set(n.x ?? 0, n.y ?? 0, n.z ?? 0)
    box.expandByPoint(vecRefs.point)
  }

  box.getCenter(vecRefs.center)
  box.getSize(vecRefs.size)

  const maxDim = Math.max(vecRefs.size.x, vecRefs.size.y, vecRefs.size.z, 8)
  const fov = camera.fov * (Math.PI / 180)
  let distance = (maxDim / 2) / Math.tan(fov / 2) * padding
  distance = Math.max(distance, 12)

  vecRefs.dir.set(0.35, 0.25, 1).normalize()
  camera.position.copy(vecRefs.center).add(vecRefs.dir.multiplyScalar(distance))
  controls.target.copy(vecRefs.center)
  controls.update()
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
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
  groupRefs: React.MutableRefObject<Map<string, THREE.Group>>
  onNodeClick: (id: string, e: ThreeEvent<MouseEvent>) => void
  onPointerDown: (id: string, e: ThreeEvent<PointerEvent>) => void
}

const NodeMesh = memo(function NodeMesh({
  node,
  isSelected,
  isConnected,
  groupRefs,
  onNodeClick,
  onPointerDown,
}: NodeMeshProps) {
  const groupRef = useRef<THREE.Group>(null)

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const refs = groupRefs.current
    refs.set(node.id, group)
    return () => {
      refs.delete(node.id)
    }
  }, [node.id, groupRefs])

  const color = GROUP_COLORS[node.group]
  const radius = node.val * 0.55
  const ringRotation = useMemo(() => hashRotation(node.id), [node.id])
  const labelOffset = useMemo(() => hashLabelOffset(node.id), [node.id])
  const labelSpread = radius * (2.65 + (node.val > 2 ? 0.45 : node.val > 1.6 ? 0.25 : 0))
  const labelPosition = useMemo(
    (): [number, number, number] => [
      labelOffset[0] * labelSpread * 0.9,
      radius * 1.15 + labelOffset[1] * labelSpread * 0.55,
      labelOffset[1] * labelSpread * 0.4 + 0.6,
    ],
    [labelOffset, labelSpread, radius],
  )

  return (
    <group ref={groupRef}>
      <mesh
        onClick={(e) => onNodeClick(node.id, e)}
        onPointerDown={(e) => onPointerDown(node.id, e)}
        onPointerOver={() => {
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'default'
        }}
        userData={{ nodeId: node.id }}
      >
        <sphereGeometry args={[radius]} />
        <meshBasicMaterial color={color} />
      </mesh>

      <mesh>
        <sphereGeometry args={[radius * 0.42]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>

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
        distanceFactor={21}
        zIndexRange={[5, 80]}
        style={{
          pointerEvents: 'none',
          userSelect: 'none',
          transform: 'translate(-50%, -50%)',
        }}
      >
        <div
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
      const rgb = hexToRgb(LINK_COLORS[link.type] || '#888888')
      const isHighlighted =
        highlightLinkIds.has(`${link.source}-${link.target}`) ||
        highlightLinkIds.has(`${link.target}-${link.source}`)
      const opacity = isHighlighted ? 0.95 : selectedId ? 0.25 : 0.55
      const r = (rgb[0] / 255) * opacity
      const g = (rgb[1] / 255) * opacity
      const b = (rgb[2] / 255) * opacity
      const base = i * 6
      col[base] = r
      col[base + 1] = g
      col[base + 2] = b
      col[base + 3] = r
      col[base + 4] = g
      col[base + 5] = b
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
          <lineBasicMaterial color="#ffffff" transparent opacity={0.6} linewidth={0.8} />
        </lineSegments>
      )}
    </>
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
  const { camera, raycaster, mouse, scene } = useThree()
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

  useEffect(() => {
    const simNodes: SimNode[] = visibleNodes.map((n) => {
      const existing = simNodesRef.current.find((sn) => sn.id === n.id)
      return {
        ...n,
        x: existing?.x ?? (Math.random() - 0.5) * 36,
        y: existing?.y ?? (Math.random() - 0.5) * 28,
        z: existing?.z ?? (Math.random() - 0.5) * 32,
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
        .strength((l) => ((l as SimLink).strength || 0.6) * 0.7)
      simRaw.force('link', linkForce)
      simRaw.force('charge', d3Force.forceManyBody().strength(-28))
      simRaw.force('center', d3Force.forceCenter(0, 0, 0))
      simRaw.force(
        'collision',
        d3Force.forceCollide().radius((d) => (d as SimNode).val * 2.05 + 0.85),
      )
      simRaw.alphaDecay(0.022)
      simRaw.velocityDecay(0.32)

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
      <Stars count={420} />

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
// ============================================
function Stars({ count = 380 }: { count?: number }) {
  const pointsRef = useRef<THREE.Points>(null!)
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const r = 48 + seededRandom(i * 3 + 1) * 38
      const theta = seededRandom(i * 3 + 2) * Math.PI * 2
      const phi = Math.acos(2 * seededRandom(i * 3 + 3) - 1)
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.6
      arr[i * 3 + 2] = r * Math.cos(phi)
    }
    return arr
  }, [count])

  const sizes = useMemo(() => {
    const arr = new Float32Array(count)
    for (let i = 0; i < count; i++) arr[i] = 0.6 + seededRandom(i + 1000) * 1.8
    return arr
  }, [count])

  useFrame(({ clock }) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y = clock.elapsedTime * 0.0008
    }
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
      </bufferGeometry>
      <pointsMaterial
        size={1.15}
        color="#e0e7ff"
        sizeAttenuation
        transparent
        opacity={0.85}
        depthWrite={false}
      />
    </points>
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
        camera={{ position: [14, 9, 26], fov: 48, near: 0.5, far: 280 }}
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
        <fog attach="fog" args={['#000000', 58, 145]} />

        <Scene {...props} />

        {!isMobile && (
          <EffectComposer>
            <Bloom
              intensity={1.35}
              luminanceThreshold={0.08}
              luminanceSmoothing={0.85}
              radius={0.78}
            />
          </EffectComposer>
        )}
      </Canvas>
    </div>
  )
}
