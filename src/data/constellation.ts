/**
 * CONSTELLATION — Data Model & Curated Dataset
 * 
 * A living map of Elon Musk's companies and their deep interconnections.
 * Sources: Company filings, NASA contracts, Electrek 10-K analysis (2025-2026),
 * official sites (spacex.com, tesla.com, x.ai, neuralink.com), public reports.
 * 
 * All revenue/valuation figures are latest available estimates (2025-2026).
 * Private companies = valuations from funding rounds / secondary markets.
 */

export type NodeType = 'core' | 'sub' | 'external'
export type LinkType = 'owns' | 'powers' | 'sells-to' | 'contracts' | 'data' | 'acquired' | 'partners' | 'infra'

export interface Node {
  id: string
  label: string
  type: NodeType
  group: 'tesla' | 'spacex' | 'xai' | 'neuralink' | 'boring' | 'x' | 'external'
  // Visual weight (radius in 3D)
  val: number
  // Short description for hover / list
  short: string
  // Full mission / positioning statement
  mission?: string
  // Key metric line (valuation, rev, or status)
  metric?: string
  // Richer detail for panel
  revenueNote?: string
  // Sub-web children ids (for dynamic expand)
  children?: string[]
  // Notable external assists / contracts
  assists?: Array<{
    target: string
    description: string
  }>
}

export interface Link {
  source: string
  target: string
  type: LinkType
  // Strength for force sim + visual thickness
  strength: number
  // Optional label shown on highlight
  label?: string
  // Human description for panel
  note?: string
}

// ============================================
// CORE NODES + SUB-WEBS + KEY EXTERNALS
// ============================================

export const NODES: Node[] = [
  // === CORE EMPIRE ===
  {
    id: 'tesla',
    label: 'Tesla',
    type: 'core',
    group: 'tesla',
    val: 2.8,
    short: 'Electric vehicles • Energy • Autonomy • Robotics',
    mission: 'Build a world of amazing abundance.',
    metric: 'Market cap ~$1T+ • 2025 Rev ~$97.7B',
    revenueNote: 'Automotive ~83% • Energy storage (Megapack) fastest growing segment • Services + Autonomy ramping.',
    children: ['tesla-energy', 'tesla-autonomy', 'tesla-optimus'],
    assists: [
      { target: 'spacex', description: 'Sells thousands of vehicles (incl. Cybertrucks) for Starbase fleet ops — $143M+ in recent filings.' },
      { target: 'xai-colossus', description: 'Deployed 200+ Megapacks ($430M+) to power the world\'s largest AI training cluster.' }
    ]
  },
  {
    id: 'spacex',
    label: 'SpaceX',
    type: 'core',
    group: 'spacex',
    val: 2.6,
    short: 'Reusable rockets • Starlink • Human spaceflight • Mars',
    mission: 'Making life multiplanetary.',
    metric: 'Valuation ~$350B+ • Rev ~$15B+ (Starlink dominant)',
    revenueNote: 'Starlink ~60%+ of revenue and growing fast (10M+ terminals). Launch + human spaceflight the rest.',
    children: ['spacex-starlink'],
    assists: [
      { target: 'nasa', description: 'Dragon crew + cargo to ISS (multiple flights/year). HLS lunar lander for Artemis program returning humans to the Moon.' },
      { target: 'tesla', description: 'Launch services & orbital comms support; Starlink connectivity for remote Tesla sites.' }
    ]
  },
  {
    id: 'xai',
    label: 'xAI',
    type: 'core',
    group: 'xai',
    val: 2.4,
    short: 'Frontier AI • Grok • Colossus supercluster',
    mission: 'Accelerate our collective understanding of the universe.',
    metric: 'Valuation ~$50B+ (2025-26)',
    revenueNote: 'Grok API + consumer/enterprise. Colossus infrastructure also leased to other AI labs.',
    children: ['xai-colossus', 'xai-grok'],
    assists: [
      { target: 'anthropic', description: 'Leases significant Colossus GPU capacity to Anthropic for their frontier model training.' },
      { target: 'x', description: 'X (acquired 2025) provides real-time data for training + distribution of Grok.' }
    ]
  },
  {
    id: 'neuralink',
    label: 'Neuralink',
    type: 'core',
    group: 'neuralink',
    val: 1.9,
    short: 'Brain-computer interfaces • Restore autonomy',
    mission: 'Restore autonomy to those with unmet medical needs today and unlock human potential tomorrow.',
    metric: 'Valuation ~$9-10B (2025)',
    revenueNote: 'Pre-revenue / clinical stage. First human patients controlling cursors, playing games, and typing with thought alone.',
    assists: []
  },
  {
    id: 'x',
    label: 'X',
    type: 'core',
    group: 'x',
    val: 2.1,
    short: 'Everything app • Public conversation • Real-time data',
    mission: 'The town square of the internet — an everything app.',
    metric: 'Acquired by xAI (2025) • Valuation private',
    revenueNote: 'Advertising + subscriptions + data licensing. Deep integration with Grok.',
    assists: [
      { target: 'xai', description: 'Primary real-time training data source for Grok models + surface for Grok responses.' }
    ]
  },
  {
    id: 'boring',
    label: 'The Boring Company',
    type: 'core',
    group: 'boring',
    val: 1.6,
    short: 'Tunnels • Urban transport • Infrastructure',
    mission: 'Solve traffic with tunnels.',
    metric: 'Valuation ~$7B',
    revenueNote: 'Vegas Loop (millions of rides), tunnels for Tesla Gigafactories, public infrastructure projects.',
    assists: [
      { target: 'tesla', description: 'Underground logistics tunnels beneath Giga Texas and other factories for vehicle/parts movement.' }
    ]
  },

  // === TESLA SUB-WEBS (major revenue/impact drivers) ===
  {
    id: 'tesla-energy',
    label: 'Tesla Energy',
    type: 'sub',
    group: 'tesla',
    val: 1.5,
    short: 'Megapack • Powerwall • Solar • Grid storage',
    mission: 'Accelerate the world\'s transition to sustainable energy — at grid scale.',
    metric: 'Fastest-growing Tesla segment',
    revenueNote: 'Megapack deployments exploding globally. 200+ units deployed to single xAI Colossus project alone.',
    assists: [
      { target: 'xai-colossus', description: 'Primary power backbone for 300k+ H100-class GPUs. One of the largest behind-the-meter storage deployments ever.' }
    ]
  },
  {
    id: 'tesla-autonomy',
    label: 'Autonomy (FSD + Robotaxi)',
    type: 'sub',
    group: 'tesla',
    val: 1.4,
    short: 'Full Self-Driving • Cybercab • Dojo supercomputer',
    mission: 'Autonomous transportation at massive scale.',
    metric: '2025: Robotaxi / Cybercab unveiled & early ops',
    revenueNote: 'FSD subscriptions + robotaxi network (future) expected to dwarf auto gross margin. Dojo trains the vision models.',
    assists: []
  },
  {
    id: 'tesla-optimus',
    label: 'Optimus',
    type: 'sub',
    group: 'tesla',
    val: 1.3,
    short: 'Humanoid general-purpose robot',
    mission: 'A useful humanoid robot in every home and factory.',
    metric: 'Production ramping 2025-2026',
    revenueNote: 'Long-term: potentially the largest opportunity. Early units working inside Tesla factories.',
    assists: [
      { target: 'spacex', description: 'Future: construction, maintenance & manufacturing labor on Mars and at Starbase.' },
      { target: 'tesla', description: 'Internal factory labor + eventual consumer product.' }
    ]
  },

  // === SPACEX SUB-WEBS ===
  {
    id: 'spacex-starlink',
    label: 'Starlink',
    type: 'sub',
    group: 'spacex',
    val: 1.7,
    short: 'Satellite broadband • Global connectivity',
    mission: 'High-speed internet everywhere on Earth (and soon Mars).',
    metric: '~10M+ terminals • Majority of SpaceX revenue',
    revenueNote: 'Residential, enterprise, maritime, aviation, government. Starlink Direct to Cell launching.',
    assists: [
      { target: 'nasa', description: 'Provides comms redundancy and high-bandwidth data for ISS and future Artemis missions.' },
      { target: 'anthropic', description: 'Critical connectivity for remote AI training clusters and global enterprise customers.' }
    ]
  },

  // === xAI SUB-WEBS ===
  {
    id: 'xai-colossus',
    label: 'Colossus',
    type: 'sub',
    group: 'xai',
    val: 1.8,
    short: 'World\'s largest AI training cluster • Memphis',
    mission: 'The compute engine for understanding the universe.',
    metric: '300k+ GPUs (expanding to 1M+) • 150+ MW power',
    revenueNote: 'Primarily internal for Grok training. Significant capacity leased to other frontier labs.',
    assists: [
      { target: 'anthropic', description: 'Leases large blocks of H100/H200 capacity for Anthropic\'s model training runs.' },
      { target: 'xai', description: 'Trains every Grok model iteration at unprecedented speed and scale.' }
    ]
  },
  {
    id: 'xai-grok',
    label: 'Grok',
    type: 'sub',
    group: 'xai',
    val: 1.5,
    short: 'Frontier reasoning models • Real-time by X',
    mission: 'Maximum truth-seeking AI with a rebellious streak.',
    metric: 'Grok-3 / Grok-4 class • API + consumer',
    revenueNote: 'API access, x.com Premium+ integration, enterprise deals.',
    assists: [
      { target: 'x', description: 'Powers Grok chatbot on X, image gen, coding, deep search, and agentic features.' }
    ]
  },

  // === EXTERNALS (real partners & contracts) ===
  {
    id: 'nasa',
    label: 'NASA',
    type: 'external',
    group: 'external',
    val: 1.1,
    short: 'Human spaceflight & exploration',
    mission: 'Explore the unknown and inspire the world.',
    metric: 'Long-term partner via COTS, CRS, CCP, HLS',
    revenueNote: 'SpaceX is NASA\'s primary commercial crew & cargo provider to the ISS.',
    assists: []
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    type: 'external',
    group: 'external',
    val: 1.0,
    short: 'Frontier AI safety-focused lab (Claude)',
    mission: 'Build reliable, interpretable, and steerable AI systems.',
    metric: 'Major Colossus compute customer',
    revenueNote: 'Pays xAI for access to massive GPU clusters during key training phases.',
    assists: []
  },
  {
    id: 'global-customers',
    label: 'Global Starlink Customers',
    type: 'external',
    group: 'external',
    val: 0.9,
    short: 'Enterprise, maritime, aviation, disaster response worldwide',
    mission: 'Connectivity everywhere on Earth.',
    metric: 'Millions of terminals globally',
    assists: []
  }
]

// ============================================
// INTERCONNECTION LINKS (the "web")
// ============================================

export const LINKS: Link[] = [
  // Ownership / Corporate structure
  { source: 'tesla', target: 'tesla-energy', type: 'owns', strength: 1.0, label: 'DIVISION', note: 'Tesla Energy is a core Tesla business unit.' },
  { source: 'tesla', target: 'tesla-autonomy', type: 'owns', strength: 0.9, label: 'DIVISION', note: 'Full Self-Driving and future Robotaxi network are Tesla initiatives.' },
  { source: 'tesla', target: 'tesla-optimus', type: 'owns', strength: 0.85, label: 'DIVISION', note: 'Optimus humanoid program run inside Tesla.' },
  { source: 'spacex', target: 'spacex-starlink', type: 'owns', strength: 1.0, label: 'DIVISION', note: 'Starlink is SpaceX\'s satellite constellation and broadband business.' },
  { source: 'xai', target: 'xai-colossus', type: 'owns', strength: 1.0, label: 'INFRA', note: 'Colossus is xAI\'s owned training cluster (Memphis).' },
  { source: 'xai', target: 'xai-grok', type: 'owns', strength: 0.95, label: 'PRODUCT', note: 'Grok models are xAI\'s flagship product line.' },
  { source: 'xai', target: 'x', type: 'acquired', strength: 0.7, label: 'ACQUIRED', note: 'X Corp acquired by xAI in 2025, creating deep data + distribution integration.' },

  // Power & Infrastructure (Tesla Energy <-> xAI)
  { source: 'tesla-energy', target: 'xai-colossus', type: 'powers', strength: 0.95, label: '$430M+ MEGAPACKS', note: 'Tesla deployed hundreds of Megapacks providing 150+ MW behind-the-meter power for Colossus.' },

  // Vehicle & Fleet sales (Tesla <-> SpaceX)
  { source: 'tesla', target: 'spacex', type: 'sells-to', strength: 0.6, label: 'CYBERTRUCK FLEET', note: '$143M+ of Tesla vehicles (incl. Cybertrucks) sold to SpaceX for Starbase operations.' },

  // Contracts & Services (SpaceX <-> NASA)
  { source: 'spacex', target: 'nasa', type: 'contracts', strength: 0.85, label: 'DRAGON + HLS', note: 'Multi-billion dollar contracts for ISS crew/cargo and Artemis lunar lander (HLS).' },

  // Compute leasing (xAI <-> Anthropic)
  { source: 'xai-colossus', target: 'anthropic', type: 'contracts', strength: 0.75, label: 'GPU LEASE', note: 'Anthropic rents large portions of Colossus capacity for frontier model training.' },

  // Data & Platform (X <-> xAI)
  { source: 'x', target: 'xai', type: 'data', strength: 0.9, label: 'TRAINING DATA + DISTRIBUTION', note: 'X is the primary real-time data source for Grok and the main surface for Grok features.' },

  // Infra (Boring <-> Tesla)
  { source: 'boring', target: 'tesla', type: 'infra', strength: 0.55, label: 'FACTORY TUNNELS', note: 'The Boring Company built underground logistics tunnels at Giga Texas for Tesla.' },

  // Cross-Elon synergies (light but real)
  { source: 'spacex', target: 'tesla', type: 'partners', strength: 0.4, label: 'SHARED OPS', note: 'Talent flow, shared suppliers, and occasional joint engineering efforts.' },
  { source: 'xai', target: 'tesla', type: 'partners', strength: 0.35, label: 'COMPUTE + TALENT', note: 'xAI uses Tesla Megapacks at massive scale; some shared engineering DNA.' },

  // External assists examples
  { source: 'spacex-starlink', target: 'nasa', type: 'contracts', strength: 0.5, label: 'COMMS', note: 'Starlink provides high-bandwidth connectivity for ISS and future deep-space missions.' },
  { source: 'spacex-starlink', target: 'global-customers', type: 'partners', strength: 0.4, label: 'GLOBAL CONNECTIVITY', note: 'Enterprise, maritime, aviation, disaster response, and remote scientific outposts worldwide.' }
]

export const nodeById = new Map(NODES.map(n => [n.id, n]))

export function getNodeById(id: string): Node | undefined {
  return nodeById.get(id)
}

// Helper: get children for a node
export function getChildren(nodeId: string): Node[] {
  const node = getNodeById(nodeId)
  if (!node?.children) return []
  return NODES.filter(n => node.children!.includes(n.id))
}

// Helper: get direct links for a node (both directions)
export function getNodeLinks(nodeId: string): Link[] {
  return LINKS.filter(l => l.source === nodeId || l.target === nodeId)
}

// Helper: get connected node ids
export function getConnectedIds(nodeId: string): string[] {
  return getNodeLinks(nodeId).map(l => l.source === nodeId ? l.target : l.source)
}

// Color helpers for groups (used in 3D + UI)
export const GROUP_COLORS: Record<Node['group'], string> = {
  tesla: '#e82127',
  spacex: '#ff4500',
  xai: '#a855f7',
  neuralink: '#22c55e',
  boring: '#eab308',
  x: '#ffffff',
  external: '#64748b'
}

export const LINK_COLORS: Record<LinkType, string> = {
  owns: '#ffffff',
  powers: '#22c55e',
  'sells-to': '#f97316',
  contracts: '#fb923c',
  data: '#c084fc',
  acquired: '#a855f7',
  partners: '#94a3b8',
  infra: '#eab308'
}

export const LINK_LABELS: Record<LinkType, string> = {
  owns: 'OWNS / DIVISION',
  powers: 'POWERS',
  'sells-to': 'SELLS TO',
  contracts: 'CONTRACT',
  data: 'DATA / PLATFORM',
  acquired: 'ACQUIRED',
  partners: 'SYNERGY',
  infra: 'INFRASTRUCTURE'
}

// Initial camera focus target (center of empire)
export const INITIAL_FOCUS = 'tesla'

/** Nodes visible in the 3D graph: core + external always; sub-nodes when parent is expanded. */
export function getVisibleNodes(expandedIds: Iterable<string>): Node[] {
  const visible = new Map<string, Node>()
  for (const node of NODES) {
    if (node.type !== 'sub') visible.set(node.id, node)
  }
  for (const parentId of expandedIds) {
    for (const child of getChildren(parentId)) {
      visible.set(child.id, child)
    }
  }
  return [...visible.values()]
}

/** Links whose source and target are both in the visible node set. */
export function getVisibleLinks(visibleNodes: Node[]): Link[] {
  const visibleIds = new Set(visibleNodes.map(n => n.id))
  return LINKS.filter(l => visibleIds.has(l.source) && visibleIds.has(l.target))
}

function validateConstellation(): void {
  const ids = new Set<string>()
  for (const node of NODES) {
    if (ids.has(node.id)) {
      throw new Error(`Duplicate node id: ${node.id}`)
    }
    ids.add(node.id)
  }

  for (const node of NODES) {
    for (const childId of node.children ?? []) {
      if (!nodeById.has(childId)) {
        throw new Error(`Node "${node.id}" references invalid child: "${childId}"`)
      }
    }
    for (const assist of node.assists ?? []) {
      if (!nodeById.has(assist.target)) {
        throw new Error(`Node "${node.id}" assist references invalid target: "${assist.target}"`)
      }
    }
  }

  for (const link of LINKS) {
    if (!nodeById.has(link.source)) {
      throw new Error(`Link references invalid source: "${link.source}"`)
    }
    if (!nodeById.has(link.target)) {
      throw new Error(`Link references invalid target: "${link.target}"`)
    }
  }
}

validateConstellation()
