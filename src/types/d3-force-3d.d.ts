declare module 'd3-force-3d' {
  export function forceSimulation<NodeDatum extends SimulationNodeDatum = SimulationNodeDatum>(
    nodes?: NodeDatum[]
  ): Simulation<NodeDatum>

  export function forceLink<NodeDatum extends SimulationNodeDatum = SimulationNodeDatum, LinkDatum extends SimulationLinkDatum<NodeDatum> = SimulationLinkDatum<NodeDatum>>(
    links?: LinkDatum[]
  ): ForceLink<NodeDatum, LinkDatum>

  export function forceManyBody<NodeDatum extends SimulationNodeDatum = SimulationNodeDatum>(): ForceManyBody<NodeDatum>

  export function forceCenter<NodeDatum extends SimulationNodeDatum = SimulationNodeDatum>(
    x?: number,
    y?: number,
    z?: number
  ): ForceCenter<NodeDatum>

  export function forceCollide<NodeDatum extends SimulationNodeDatum = SimulationNodeDatum>(
    radius?: number | ((node: NodeDatum, i: number, nodes: NodeDatum[]) => number)
  ): ForceCollide<NodeDatum>

  export interface SimulationNodeDatum {
    index?: number
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

  export interface SimulationLinkDatum<NodeDatum extends SimulationNodeDatum = SimulationNodeDatum> {
    source: NodeDatum | string | number
    target: NodeDatum | string | number
    index?: number
  }

  export interface Simulation<NodeDatum extends SimulationNodeDatum = SimulationNodeDatum> {
    nodes(nodes: NodeDatum[]): this
    nodes(): NodeDatum[]
    force(name: string, force?: Force<SimulationNodeDatum, SimulationLinkDatum> | null): this | Force<SimulationNodeDatum, SimulationLinkDatum> | undefined
    alpha(alpha: number): this
    alpha(): number
    alphaTarget(target: number): this
    alphaTarget(): number
    alphaMin(min: number): this
    alphaMin(): number
    alphaDecay(decay: number): this
    alphaDecay(): number
    velocityDecay(decay: number): this
    velocityDecay(): number
    tick(iterations?: number): this
    restart(): this
    stop(): this
    on(typenames: string, listener?: (event: { type: string; alpha: number }) => void): this
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- second type param used by extending interfaces
  export interface Force<NodeDatum extends SimulationNodeDatum, LinkDatum extends SimulationLinkDatum<NodeDatum> | undefined> {
    (alpha: number): void
    initialize?(nodes: NodeDatum[], random: () => number): void
  }

  export interface ForceLink<NodeDatum extends SimulationNodeDatum, LinkDatum extends SimulationLinkDatum<NodeDatum>> extends Force<NodeDatum, LinkDatum> {
    links(links: LinkDatum[]): this
    links(): LinkDatum[]
    id(id: (node: NodeDatum, i: number, nodes: NodeDatum[]) => string | number): this
    strength(strength: number | ((link: LinkDatum, i: number, links: LinkDatum[]) => number)): this
    distance(distance: number | ((link: LinkDatum, i: number, links: LinkDatum[]) => number)): this
  }

  export interface ForceManyBody<NodeDatum extends SimulationNodeDatum> extends Force<NodeDatum, undefined> {
    strength(strength: number | ((node: NodeDatum, i: number, nodes: NodeDatum[]) => number)): this
  }

  export interface ForceCenter<NodeDatum extends SimulationNodeDatum> extends Force<NodeDatum, undefined> {
    x(x: number): this
    y(y: number): this
    z(z: number): this
  }

  export interface ForceCollide<NodeDatum extends SimulationNodeDatum> extends Force<NodeDatum, undefined> {
    radius(radius: number | ((node: NodeDatum, i: number, nodes: NodeDatum[]) => number)): this
    strength(strength: number): this
    iterations(iterations: number): this
  }
}
