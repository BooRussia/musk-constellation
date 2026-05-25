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
  /**
   * Visual weight (radius in 3D). Derived from valuation:
   *  - cores & externals: `cbrt(valuationBillions) * 0.36`
   *  - subs: `sqrt(shareOfParent) * parent.val` so visual area is
   *    proportional to the sub's share of the parent's value.
   * Pre-computed and stored here rather than recomputed at render time.
   */
  val: number
  /** USD valuation in billions (latest 2025-26 estimate). Optional for
   *  externals where a comparable corporate valuation isn't meaningful. */
  valuationB?: number
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

// Visual sizing scale: vals derived from real valuations so the orb a viewer
// sees actually reflects what each entity is worth.
//
//   cores / externals: val = cbrt(valuationBillions) * 0.36
//     SpaceX  $1500B → 4.12 (pre-IPO target, post-xAI merger)
//     Tesla   $1000B → 3.60
//     xAI     $250B  → 2.27 (merger valuation Feb 2026, acquired by SpaceX)
//     X       $30B   → 1.12
//     Cursor  $29B   → 1.10 ($60B SpaceX acq option, Apr 2026)
//     Neural  $9B    → 0.75     Boring  $7B → 0.69
//
//   subs: val = sqrt(shareOfParent) * parent.val
//     Visual *area* is proportional to share of parent — a sub worth 25% of
//     its parent's value renders as an orb half the parent's radius.
export const NODES: Node[] = [
  // === CORE EMPIRE ===
  {
    id: 'tesla',
    label: 'Tesla',
    type: 'core',
    group: 'tesla',
    valuationB: 1000,
    val: 3.60, // cbrt(1000)*0.36
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
    valuationB: 1500,
    val: 4.12, // cbrt(1500)*0.36
    short: 'Rockets • Starlink • Spaceflight • Acquired xAI (2026) • Mars',
    mission: 'Making life multiplanetary.',
    metric: 'Valuation ~$1.5T (pre-IPO target) • Acquired xAI Feb 2026',
    revenueNote: 'Starlink ~60%+ of revenue (10M+ terminals). Acquired xAI Feb 2026 in $1.25T combined deal — now building orbital data centers post-merger. SpaceX IPO targeted later 2026.',
    children: ['spacex-starlink'],
    assists: [
      { target: 'nasa', description: 'Dragon crew + cargo to ISS (multiple flights/year). HLS lunar lander for Artemis program returning humans to the Moon.' }
    ]
  },
  {
    id: 'xai',
    label: 'xAI',
    type: 'core',
    group: 'xai',
    valuationB: 250,
    val: 2.27, // cbrt(250)*0.36
    short: 'Frontier AI • Grok • Colossus • Acquired by SpaceX (Feb 2026)',
    mission: 'Accelerate our collective understanding of the universe.',
    metric: 'Valued at $250B in SpaceX merger (Feb 2026)',
    revenueNote: 'Grok API + consumer/enterprise + X integration. Colossus capacity leased to other AI labs. Acquired by SpaceX Feb 2026 — combined entity ~$1.25T, with plans for space-based AI data centers.',
    children: ['xai-colossus', 'xai-grok'],
    assists: [
      { target: 'anthropic', description: 'Leases significant Colossus GPU capacity to Anthropic for their frontier model training.' }
    ]
  },
  {
    id: 'neuralink',
    label: 'Neuralink',
    type: 'core',
    group: 'neuralink',
    valuationB: 9,
    val: 0.75, // cbrt(9)*0.36
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
    valuationB: 30,
    val: 1.12, // cbrt(30)*0.36
    short: 'Everything app • Public conversation • Real-time data',
    mission: 'The town square of the internet — an everything app.',
    metric: 'Acquired by xAI (2025) • Valuation ~$30B',
    revenueNote: 'Advertising + subscriptions + data licensing. Deep integration with Grok.',
    assists: []
  },
  {
    id: 'boring',
    label: 'The Boring Company',
    type: 'core',
    group: 'boring',
    valuationB: 7,
    val: 0.69, // cbrt(7)*0.36
    short: 'Tunnels • Urban transport • Music City Loop (2026)',
    mission: 'Solve traffic with tunnels.',
    metric: 'Valuation ~$7B • Music City Loop under construction',
    revenueNote: 'Vegas Loop (millions of rides), Music City Loop in Nashville (~13mi, $240-300M, fully privately funded — Phase 1 BNA→Capitol targeted late 2026, full route 2029), tunnels for Tesla Gigafactories, additional city RFPs in evaluation.',
    children: ['boring-music-city'],
    assists: []
  },

  // === TESLA SUB-WEBS (sized as share of Tesla's $1T value) ===
  {
    id: 'tesla-energy',
    label: 'Tesla Energy',
    type: 'sub',
    group: 'tesla',
    valuationB: 250, // ~25% of Tesla's value as the fastest-growing segment
    val: 1.80, // sqrt(0.25) * 3.60
    short: 'Megapack • Powerwall • Solar • Grid storage',
    mission: 'Accelerate the world\'s transition to sustainable energy — at grid scale.',
    metric: '~25% of Tesla value • Fastest-growing segment',
    revenueNote: 'Megapack deployments exploding globally. 200+ units deployed to single xAI Colossus project alone.',
    assists: []
  },
  {
    id: 'tesla-autonomy',
    label: 'Autonomy (FSD + Robotaxi)',
    type: 'sub',
    group: 'tesla',
    valuationB: 200, // ~20% optionality from FSD + Robotaxi network
    val: 1.61, // sqrt(0.20) * 3.60
    short: 'Full Self-Driving • Cybercab • Dojo supercomputer',
    mission: 'Autonomous transportation at massive scale.',
    metric: '~20% of Tesla value • 2025 Robotaxi/Cybercab early ops',
    revenueNote: 'FSD subscriptions + robotaxi network (future) expected to dwarf auto gross margin. Dojo trains the vision models.',
    assists: []
  },
  {
    id: 'tesla-optimus',
    label: 'Optimus',
    type: 'sub',
    group: 'tesla',
    valuationB: 80, // ~8% — small today, massive future optionality
    val: 1.02, // sqrt(0.08) * 3.60
    short: 'Humanoid general-purpose robot',
    mission: 'A useful humanoid robot in every home and factory.',
    metric: '~8% of Tesla value (optionality) • Production ramping',
    revenueNote: 'Long-term: potentially the largest opportunity. Early units working inside Tesla factories.',
    assists: []
  },

  // === SPACEX SUB-WEBS ===
  {
    id: 'spacex-starlink',
    label: 'Starlink',
    type: 'sub',
    group: 'spacex',
    valuationB: 675, // ~45% of SpaceX value — majority revenue + biggest growth
    val: 2.77, // sqrt(0.45) * 4.12
    short: 'Satellite broadband • Global connectivity',
    mission: 'High-speed internet everywhere on Earth (and soon Mars).',
    metric: '~45% of SpaceX value • ~10M+ terminals',
    revenueNote: 'Residential, enterprise, maritime, aviation, government. Starlink Direct to Cell launching.',
    assists: []
  },

  // === xAI SUB-WEBS ===
  {
    id: 'xai-colossus',
    label: 'Colossus',
    type: 'sub',
    group: 'xai',
    valuationB: 138, // ~55% — the moat (largest training cluster in the world)
    val: 1.68, // sqrt(0.55) * 2.27
    short: 'World\'s largest AI training cluster • Memphis',
    mission: 'The compute engine for understanding the universe.',
    metric: '~55% of xAI value • 300k+ GPUs (1M+ target) • 150+ MW',
    revenueNote: 'Primarily internal for Grok training. Significant capacity leased to other frontier labs. Foundation for SpaceX\'s planned orbital data centers post-merger.',
    assists: [
      { target: 'anthropic', description: 'Leases large blocks of H100/H200 capacity for Anthropic\'s model training runs.' }
    ]
  },
  {
    id: 'xai-grok',
    label: 'Grok',
    type: 'sub',
    group: 'xai',
    valuationB: 75, // ~30% of xAI — the product surface
    val: 1.24, // sqrt(0.30) * 2.27
    short: 'Frontier reasoning models • Real-time by X',
    mission: 'Maximum truth-seeking AI with a rebellious streak.',
    metric: '~30% of xAI value • Grok-3 / Grok-4 class',
    revenueNote: 'API access, x.com Premium+ integration, enterprise deals.',
    assists: []
  },

  // === BORING COMPANY SUB-WEBS ===
  {
    id: 'boring-music-city',
    label: 'Music City Loop',
    type: 'sub',
    group: 'boring',
    valuationB: 2.5, // ~35% of Boring — flagship active project, ~13mi twin tunnels
    val: 0.41, // sqrt(0.35) * 0.69
    short: 'Nashville: BNA airport → Capitol → Lower Broadway',
    mission: 'Zero-emission underground transit for Nashville.',
    metric: '~13 miles • $240-300M • Construction started Feb 2026',
    revenueNote: 'TDOT + Federal Highway approval Feb 25, 2026. Phase 1 (Capitol → BNA, ~10mi) targeted late 2026. Full route through downtown Music City Center + Lower Broadway by 2029. Fully privately funded; Prufrock-MB1 tunneling machine on-site.',
    assists: []
  },

  // === EXTERNALS (real partners & contracts) ===
  {
    id: 'nasa',
    label: 'NASA',
    type: 'external',
    group: 'external',
    // NASA is an agency, not a private company. Sized to read as a major
    // institutional partner without competing with Tesla/SpaceX visually.
    val: 1.45,
    short: 'Human spaceflight & exploration',
    mission: 'Explore the unknown and inspire the world.',
    metric: 'FY annual budget ~$25B • Long-term SpaceX partner',
    revenueNote: 'SpaceX is NASA\'s primary commercial crew & cargo provider to the ISS.',
    assists: []
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    type: 'external',
    group: 'external',
    valuationB: 60,
    val: 1.41, // cbrt(60)*0.36
    short: 'Frontier AI safety-focused lab (Claude)',
    mission: 'Build reliable, interpretable, and steerable AI systems.',
    metric: 'Valuation ~$60B • Major Colossus compute customer',
    revenueNote: 'Pays xAI for access to massive GPU clusters during key training phases.',
    assists: []
  },
  {
    id: 'global-customers',
    label: 'Global Starlink Customers',
    type: 'external',
    group: 'external',
    // Aggregate of millions of terminals — sized as a sizable market presence
    // but smaller than individual corporate orbs.
    val: 0.95,
    short: 'Enterprise, maritime, aviation, disaster response worldwide',
    mission: 'Connectivity everywhere on Earth.',
    metric: 'Millions of terminals globally',
    assists: []
  },
  {
    id: 'cursor',
    label: 'Cursor',
    type: 'external',
    group: 'external',
    valuationB: 29, // Nov 2025 standalone valuation; SpaceX acq option struck at $60B
    val: 1.10, // cbrt(29)*0.36
    short: 'AI coding IDE • Anysphere • $60B SpaceX acquisition option',
    mission: 'AI-native software development at scale.',
    metric: '~$29B valuation • $2B+ ARR • $60B SpaceX acq option (Apr 2026)',
    revenueNote: 'SpaceX has the right to acquire parent Anysphere for $60B later in 2026, or pay $10B as a collaboration fee if it walks. Cursor gains access to Colossus compute (effectively ~1M H100s) post-deal.',
    assists: []
  }
]

// ============================================
// INTERCONNECTION LINKS (the "web")
// ============================================

// Links are directed: `source` is the entity providing/owning/initiating
// and `target` is the entity receiving/owned/responding. Vague "synergy"
// or "talent flow" ties have been removed — only concrete, day-to-day
// working relationships remain.
export const LINKS: Link[] = [
  // === Ownership / Corporate structure (parent → child) ===
  { source: 'tesla', target: 'tesla-energy', type: 'owns', strength: 1.0, label: 'DIVISION', note: 'Tesla Energy is a core Tesla business unit (Megapack, Powerwall, Solar).' },
  { source: 'tesla', target: 'tesla-autonomy', type: 'owns', strength: 0.9, label: 'DIVISION', note: 'Full Self-Driving and the future Robotaxi network are Tesla initiatives.' },
  { source: 'tesla', target: 'tesla-optimus', type: 'owns', strength: 0.85, label: 'DIVISION', note: 'Optimus humanoid program run inside Tesla.' },
  { source: 'spacex', target: 'spacex-starlink', type: 'owns', strength: 1.0, label: 'DIVISION', note: 'Starlink is SpaceX\'s satellite constellation and broadband business.' },
  { source: 'xai', target: 'xai-colossus', type: 'owns', strength: 1.0, label: 'INFRA', note: 'Colossus is xAI\'s owned training cluster in Memphis.' },
  { source: 'xai', target: 'xai-grok', type: 'owns', strength: 0.95, label: 'PRODUCT', note: 'Grok models are xAI\'s flagship product line.' },
  { source: 'xai', target: 'x', type: 'acquired', strength: 0.85, label: 'ACQUIRED 2025', note: 'X Corp acquired by xAI in 2025, creating deep data + distribution integration.' },
  { source: 'spacex', target: 'xai', type: 'acquired', strength: 1.0, label: 'ACQUIRED FEB 2026', note: 'SpaceX acquired xAI in Feb 2026 — largest M&A deal ever, $1.25T combined entity. Plans orbital data centers powered by Colossus.' },
  { source: 'boring', target: 'boring-music-city', type: 'owns', strength: 1.0, label: 'PROJECT', note: 'Music City Loop is The Boring Company\'s flagship active project (Nashville).' },

  // === Power supply (provider → consumer) ===
  { source: 'tesla-energy', target: 'xai-colossus', type: 'powers', strength: 0.95, label: '$430M+ MEGAPACKS', note: 'Tesla deployed 200+ Megapacks providing 150+ MW of behind-the-meter power for Colossus.' },

  // === Hardware sales (seller → buyer) ===
  { source: 'tesla', target: 'spacex', type: 'sells-to', strength: 0.6, label: 'CYBERTRUCK FLEET', note: '$143M+ of Tesla vehicles (incl. Cybertrucks) sold to SpaceX for Starbase fleet ops.' },

  // === Service contracts (provider → customer) ===
  { source: 'spacex', target: 'nasa', type: 'contracts', strength: 0.85, label: 'DRAGON + HLS', note: 'Multi-billion-dollar contracts for ISS crew/cargo (Dragon) and the Artemis lunar lander (HLS).' },
  { source: 'xai-colossus', target: 'anthropic', type: 'contracts', strength: 0.75, label: 'GPU LEASE', note: 'Anthropic rents large blocks of Colossus capacity for frontier model training.' },
  { source: 'spacex-starlink', target: 'nasa', type: 'contracts', strength: 0.5, label: 'COMMS', note: 'Starlink provides high-bandwidth connectivity for the ISS and future deep-space missions.' },
  { source: 'spacex', target: 'cursor', type: 'contracts', strength: 0.75, label: '$60B ACQ OPTION', note: 'SpaceX has right to acquire Anysphere (Cursor) for $60B in 2026, or $10B for collaboration only. Cursor unlocks Colossus compute access.' },

  // === Data / platform (data source → consumer) ===
  { source: 'x', target: 'xai', type: 'data', strength: 0.9, label: 'TRAINING DATA + DISTRIBUTION', note: 'X is the primary real-time data source for Grok and the main surface where Grok features ship.' },

  // === Infrastructure build (builder → consumer) ===
  { source: 'boring', target: 'tesla', type: 'infra', strength: 0.55, label: 'FACTORY TUNNELS', note: 'The Boring Company built underground logistics tunnels at Giga Texas for Tesla.' },

  // === Connectivity (provider → broad market) ===
  { source: 'spacex-starlink', target: 'global-customers', type: 'partners', strength: 0.5, label: 'GLOBAL CONNECTIVITY', note: 'Enterprise, maritime, aviation, disaster response, and remote scientific outposts worldwide.' }
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

/**
 * Direction-aware labels for the details panel. Each link type has a
 * different verb depending on whether the viewing node is the source
 * (outgoing) or the target (incoming) of the relationship.
 *
 * Example: an `owns` link from Tesla → Tesla Energy reads as
 *   "Owns" when viewing Tesla, and "Owned by" when viewing Tesla Energy.
 */
export const LINK_ROLE_LABELS: Record<LinkType, { outgoing: string; incoming: string }> = {
  owns:        { outgoing: 'Owns',          incoming: 'Owned by' },
  powers:      { outgoing: 'Powers',        incoming: 'Powered by' },
  'sells-to':  { outgoing: 'Sells to',      incoming: 'Buys from' },
  contracts:  { outgoing: 'Contracts',     incoming: 'Contracted by' },
  data:        { outgoing: 'Feeds data to', incoming: 'Sources data from' },
  acquired:    { outgoing: 'Acquired',      incoming: 'Acquired by' },
  partners:    { outgoing: 'Serves',        incoming: 'Served by' },
  infra:       { outgoing: 'Built infra for', incoming: 'Infra built by' },
}

/** Returns the side a node sits on for a given link. */
export function getLinkRole(link: Link, viewingNodeId: string): 'outgoing' | 'incoming' | 'unrelated' {
  if (link.source === viewingNodeId) return 'outgoing'
  if (link.target === viewingNodeId) return 'incoming'
  return 'unrelated'
}

/** Direction-aware verb describing what the viewing node does in this link. */
export function getLinkRoleLabel(link: Link, viewingNodeId: string): string {
  const role = getLinkRole(link, viewingNodeId)
  if (role === 'unrelated') return LINK_LABELS[link.type]
  return LINK_ROLE_LABELS[link.type][role]
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
