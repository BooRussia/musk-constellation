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
  /** Optional per-node color override (hex). Used to give individual
   *  external orbs their own thematic color instead of the shared
   *  external grey. Ignored for cores and subs (they always use group). */
  color?: string
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
//     SpaceX     $1850B → 4.43 (S-1 filed May 20 2026, $1.75-2T target)
//     Tesla      $1600B → 4.21
//     Anthropic  $380B  → 2.61 (Series G post Feb 2026)
//     xAI        $250B  → 2.27 (merger price Feb 2026, now part of SpaceX)
//     Cursor     $50B   → 1.33 (in talks at $50B Apr 2026; $60B SpaceX option)
//     X          $45B   → 1.28
//     Neuralink  $14B   → 0.87 (secondary, May 2026)
//     Boring     $7B    → 0.69
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
    valuationB: 1600,
    val: 4.21, // cbrt(1600)*0.36
    short: 'EVs • Energy • Autonomy • Robotics • Custom AI silicon',
    mission: 'Build a world of amazing abundance.',
    metric: 'Market cap ~$1.6T • 2026 Rev pace ~$95-100B',
    revenueNote: 'Automotive ~72.5% • FSD subs hit 1.28M (+51% YoY, $213M+ ARR, $99/mo) • Robotaxi live unsupervised in Austin/Dallas/Houston (1,190 sq mi) • Cybercab production started at Giga Texas • Energy +27% to $12.8B in 2025 with Megapack 3 ramping • Optimus Gen 3 in production at Fremont • Invested $2B into xAI Jan 2026 • Terafab JV w/ SpaceX + Intel for $55B chip fab in Austin.',
    children: ['tesla-energy', 'tesla-autonomy', 'tesla-optimus', 'tesla-semi', 'tesla-lithium', 'tesla-ai-chips'],
    assists: [
      { target: 'spacex', description: 'Cybertruck + Model Y fleet for Starbase ops ($143M+ historically), plus $697M in Megapacks 2024-25 powering launch ops.' },
      { target: 'xai-colossus', description: 'Tesla Megapacks (200+ units, $430M+ initial, $890M+ to date) powering the largest AI training cluster.' }
    ]
  },
  {
    id: 'spacex',
    label: 'SpaceX',
    type: 'core',
    group: 'spacex',
    valuationB: 1850,
    val: 4.43, // cbrt(1850)*0.36
    short: 'Rockets • Starlink • Starship • Starshield • Orbital DCs • Acq. xAI',
    mission: 'Making life multiplanetary.',
    metric: 'S-1 filed May 20, 2026 • Valuation ~$1.85T • SPCX listing late June',
    revenueNote: 'S-1 filed targeting $1.75-2T at ~$75B raise (largest IPO ever). On pace for ~140 Falcon launches in 2026 (61 done by May 25, ~40% of global cadence). Starlink at ~10M subs / ~$11.8B run-rate, targeting 25M by year-end via T-Mobile Direct-to-Cell. Starship V3 flew its 12th test May 22, 2026. First "Aether-1" 100MW orbital data center module targeted late 2026 post-xAI merger. EchoStar $19.6B spectrum acquisition FCC-approved May 2026.',
    children: ['spacex-starlink', 'spacex-starship', 'spacex-falcon', 'spacex-starshield', 'spacex-celestia'],
    assists: [
      { target: 'nasa', description: 'Dragon crew/cargo (CRS-34 launched May 15, 2026) + Artemis HLS Starship lunar lander ($4.04B awards combined).' }
    ]
  },
  {
    id: 'xai',
    label: 'xAI',
    type: 'core',
    group: 'xai',
    valuationB: 250,
    val: 2.27, // cbrt(250)*0.36
    short: 'Grok 4.3 • Colossus 1 + 2 • Acq. by SpaceX • Federal AI',
    mission: 'Accelerate our collective understanding of the universe.',
    metric: '~$2B ARR run-rate (2026) • Grok 4.3 flagship • Colossus 2 at 555k GPUs / 2GW',
    revenueNote: 'Grok 4.3 (May 2026) at $1.25/Mtok input, 1M context, native video; ~117M MAU / 6.3M paid subs / $1B+ subscription ARR. Anthropic took 100% of Colossus 1 at $1.25B/mo through May 2029 ($15B+/yr). Colossus 2 ramping toward 1M GPUs at 2GW. Federal: $200M DoD ceiling + GSA OneGov $0.42/agency. Acquired by SpaceX Feb 2026 ($1.25T combined). Jointly developing orbital data center constellation w/ SpaceX (Project Celestia).',
    children: ['xai-colossus', 'xai-colossus-2', 'xai-grok', 'xai-grok-imagine'],
    assists: [
      { target: 'anthropic', description: 'Anthropic now leasing 100% of Colossus 1 at $1.25B/month through May 2029.' }
    ]
  },
  {
    id: 'neuralink',
    label: 'Neuralink',
    type: 'core',
    group: 'neuralink',
    valuationB: 14,
    val: 0.87, // cbrt(14)*0.36
    short: 'BCI • Telepathy • Blindsight • VOICE • R1 surgical robot',
    mission: 'Restore autonomy to those with unmet medical needs today and unlock human potential tomorrow.',
    metric: 'Valuation ~$14-15B (secondary, May 2026) • 24+ implants',
    revenueNote: '21 PRIME patients on N1 by Jan 2026, 24+ by May including first VOICE speech-restoration trial participants. Zero serious adverse events reported. R1 surgical robot near-fully automated. Blindsight (visual cortex) holds FDA Breakthrough Device Designation with first human implants targeted for 2026. Patient experience now uses Grok to suggest replies for nonverbal users.',
    children: ['nlink-telepathy', 'nlink-voice', 'nlink-blindsight', 'nlink-r1'],
    assists: []
  },
  {
    id: 'x',
    label: 'X',
    type: 'core',
    group: 'x',
    valuationB: 45,
    val: 1.28, // cbrt(45)*0.36
    short: 'Everything app • 611M MAU • Acquired by xAI 2025 → SpaceX 2026',
    mission: 'The town square of the internet — an everything app.',
    metric: '611M MAU • 259M DAU • 14.2M Premium subs (4.7M Premium+)',
    revenueNote: 'Ad rev recovering ~$2.95B in 2025 / ~$750M Q1 2026 (CPMs still soft at $5.42). Premium grew 38% YoY to 14.2M (~$1.7B ARR). Primary real-time training + distribution surface for Grok. X Money entered early public access April 2026 (Visa rails, FDIC via Cross River, 6% APY). X TV launched on Fire TV / LG webOS / Android TV.',
    children: ['x-ads', 'x-premium', 'x-money', 'x-tv'],
    assists: []
  },
  {
    id: 'boring',
    label: 'The Boring Company',
    type: 'core',
    group: 'boring',
    valuationB: 7,
    val: 0.69, // cbrt(7)*0.36
    short: 'Vegas Loop • Music City Loop • Dubai Loop • Factory tunnels',
    mission: 'Solve traffic with tunnels.',
    metric: 'Valuation ~$7B (secondary) • 3 active loops + Gigafactory tunnels',
    revenueNote: 'Vegas Loop (8 stations, ~130 Tesla fleet, Airport Connector finishing Q1 2026, downtown + Chinatown expansion approved). Music City Loop (Nashville, ~13mi, $240-300M, construction started Feb 2026). Dubai Loop (contract signed with RTA — pilot 6.4km/4 stations, tunneling H2 2026). Tesla Gigafactory tunnels ongoing. Prufrock-5 TBM rolled out early 2026.',
    children: ['boring-vegas-loop', 'boring-music-city', 'boring-dubai-loop'],
    assists: []
  },

  // === TESLA SUB-WEBS (sized as share of Tesla's $1.6T value) ===
  {
    id: 'tesla-energy',
    label: 'Tesla Energy',
    type: 'sub',
    group: 'tesla',
    valuationB: 400, // ~25% of Tesla
    val: 2.10, // sqrt(0.25) * 4.21
    short: 'Megapack 3 • Megablock 20MWh • Powerwall • Solar',
    mission: 'Accelerate the world\'s transition to sustainable energy — at grid scale.',
    metric: '2025 Rev $12.8B (+27%) • 46.7 GWh deployed • Megapack 3 + Houston Megafactory ramping',
    revenueNote: 'Megapack 3 + 20MWh Megablock launching 2026. Third Megafactory in Houston adds +50 GWh capacity. Q1 2026 dipped 12% YoY during product transition but H2 ramp expected. Powering xAI Colossus 1 + 2 (~1GW), Starbase ops, Intersect Power Oberon (1GWh) and many utility-scale customers.',
    assists: []
  },
  {
    id: 'tesla-autonomy',
    label: 'Autonomy (FSD + Robotaxi)',
    type: 'sub',
    group: 'tesla',
    valuationB: 450, // bumped to ~28% — Robotaxi is the 2026 story
    val: 2.23, // sqrt(0.28) * 4.21
    short: 'FSD • Cybercab • Unsupervised Robotaxi (Austin/Dallas/Houston)',
    mission: 'Autonomous transportation at massive scale.',
    metric: '1.28M FSD subs • Unsupervised Robotaxi in 3 TX cities • Cybercab production at Giga TX',
    revenueNote: 'FSD subscription-only Feb 2026 at $99/mo, 1.28M subs (+51% YoY, $213M+ ARR). Unsupervised Robotaxi live in Austin + Dallas + Houston (1,190 sq mi). Cybercab in production at Giga Texas. Dojo training program wound down Aug 2025; Tesla AI compute migrated to Cortex (NVIDIA-based) and new AI5/AI6 silicon roadmap.',
    assists: []
  },
  {
    id: 'tesla-optimus',
    label: 'Optimus',
    type: 'sub',
    group: 'tesla',
    valuationB: 128, // ~8% — small today, massive future optionality
    val: 1.19, // sqrt(0.08) * 4.21
    short: 'Humanoid general-purpose robot — Gen 3 in production',
    mission: 'A useful humanoid robot in every home and factory.',
    metric: 'Gen 3 production started Jan 2026 • 50K-100K unit 2026 target • Internal use only',
    revenueNote: 'Mass production at Fremont since Jan 21, 2026. ~1,000 units deployed internally; V3 reveal pushed to late July/Aug 2026. Giga Texas factory targeting 10M/yr long-term. Consumer sales pushed to end of 2027. Planned as cargo on 5 uncrewed Starship V3 Mars landers in the 2026/27 window.',
    assists: []
  },
  {
    id: 'tesla-semi',
    label: 'Tesla Semi',
    type: 'sub',
    group: 'tesla',
    valuationB: 48, // ~3%
    val: 0.73, // sqrt(0.03) * 4.21
    short: 'Class 8 electric truck • Nevada factory online',
    mission: 'Electrify long-haul freight.',
    metric: 'High-volume production began Apr 2026 • 50K/yr design capacity',
    revenueNote: '1.7M sq ft Nevada factory opened Q1 2026, high-volume production line live April 2026. Targeting 5K-15K deliveries in 2026 with vertically-integrated on-site 4680 cells. PepsiCo + Frito-Lay among launch customers.',
    assists: []
  },
  {
    id: 'tesla-lithium',
    label: 'Corpus Christi Refinery',
    type: 'sub',
    group: 'tesla',
    valuationB: 32, // ~2%
    val: 0.60, // sqrt(0.02) * 4.21
    short: 'First large-scale US lithium hydroxide refinery',
    mission: 'Vertically integrate the cell supply chain.',
    metric: 'Fully operational Jan 2026 • Novel acid-free alkaline-leach process',
    revenueNote: 'Largest lithium hydroxide refinery in North America. Feeds Giga Texas cell production. Breaks China refining dependency for FSD-grade and Megapack-grade cells.',
    assists: []
  },
  {
    id: 'tesla-ai-chips',
    label: 'AI5 / AI6 Silicon',
    type: 'sub',
    group: 'tesla',
    valuationB: 80, // ~5%
    val: 0.94, // sqrt(0.05) * 4.21
    short: 'Custom AI silicon for FSD + Optimus + Dojo3',
    mission: 'Vertically-owned inference silicon at Optimus scale.',
    metric: 'AI6 at Samsung Taylor TX fab on 2nm ($16.5B deal) • AI5 in production',
    revenueNote: 'AI5 already powering FSD HW5 cars. AI6 mass production at Samsung Taylor TX fab — $16.5B 2nm deal. Dojo 3 program restarted Jan 2026 reframed as space-based compute, overlapping with the SpaceX-xAI orbital data center initiative.',
    assists: []
  },

  // === SPACEX SUB-WEBS ===
  {
    id: 'spacex-starlink',
    label: 'Starlink',
    type: 'sub',
    group: 'spacex',
    valuationB: 833, // ~45% of SpaceX value — majority revenue + biggest growth
    val: 2.97, // sqrt(0.45) * 4.43
    short: 'Satellite broadband • Direct-to-Cell • 10M+ subs',
    mission: 'High-speed internet everywhere on Earth (and soon Mars).',
    metric: '~10M subs (Feb 2026) • Targeting 25M by year-end • ~$11.8B 2025 rev',
    revenueNote: 'Adding ~52k subs/day; 657+ Direct-to-Cell sats backing T-Mobile T-Satellite commercial service (CONUS+PR+HI+AK+NZ at $10/mo). ARPU ~$81/mo. Live at Tesla Superchargers; Cybercab tests with Starlink Mini for fleet management.',
    assists: []
  },
  {
    id: 'spacex-starship',
    label: 'Starship / Super Heavy',
    type: 'sub',
    group: 'spacex',
    valuationB: 333, // ~18% of SpaceX
    val: 1.88, // sqrt(0.18) * 4.43
    short: 'Fully-reusable super-heavy launch system',
    mission: 'Make life multiplanetary.',
    metric: 'V3 flying • 12 tests through May 2026 • 5 uncrewed Mars Starships planned',
    revenueNote: 'V3 test flight May 22, 2026. 5 uncrewed Mars cargo Starships planned for the 2026 window carrying Optimus + supplies. Selected as Artemis Human Landing System for NASA ($4.04B). Foundation for orbital data center deployment.',
    assists: []
  },
  {
    id: 'spacex-falcon',
    label: 'Falcon 9 / Heavy',
    type: 'sub',
    group: 'spacex',
    valuationB: 222, // ~12% of SpaceX
    val: 1.53, // sqrt(0.12) * 4.43
    short: 'Reusable workhorse rocket • ~140 launches/yr',
    mission: 'Reliable, low-cost orbital access.',
    metric: '61 launches by May 25, 2026 • Targeting ~140 (40% of global cadence)',
    revenueNote: 'Falcon 9 dominates global launch market. Also flies Cygnus resupply for NASA, NSSL national security missions, and crewed Dragon flights. Currently the only certified US human-rated launcher.',
    assists: []
  },
  {
    id: 'spacex-starshield',
    label: 'Starshield',
    type: 'sub',
    group: 'spacex',
    valuationB: 148, // ~8% of SpaceX
    val: 1.25, // sqrt(0.08) * 4.43
    short: 'Classified DoD/NRO satellite constellation',
    mission: 'Military variant of Starlink for national security.',
    metric: 'NRO spy-sat constellation operational • $1.8B+ NRO + Space Force awards',
    revenueNote: 'NRO classified spy-sat constellation operational since May 2024. 480-sat MILNET constellation deployment begins mid-2026, IOC late 2027. $1B+ in SDA/USSF awards through FY26. PLEO program ceiling raised to $13B.',
    assists: []
  },
  {
    id: 'spacex-celestia',
    label: 'Project Celestia (Orbital DCs)',
    type: 'sub',
    group: 'spacex',
    valuationB: 222, // ~12% of SpaceX (massive future bet)
    val: 1.53, // sqrt(0.12) * 4.43
    short: 'Solar-powered orbital AI data centers (xAI compute)',
    mission: 'Move AI training off-planet.',
    metric: 'Aether-1 100MW module targeted late 2026 • FCC filing for up to 1M sats',
    revenueNote: 'Post-xAI merger initiative. FCC filing for up to 1 million compute satellites. Solar-powered; Starlink V3 optical crosslinks (1Tbps) for ground backhaul. Aether-1 100MW module targeted late 2026; will host Grok / Colossus workloads in orbit.',
    assists: []
  },

  // === xAI SUB-WEBS ===
  {
    id: 'xai-colossus',
    label: 'Colossus (Memphis 1)',
    type: 'sub',
    group: 'xai',
    valuationB: 63, // ~25% — fully leased to Anthropic, ~$15B/yr revenue
    val: 1.14, // sqrt(0.25) * 2.27
    short: 'Original Memphis cluster • 220k GPUs • 100% Anthropic-leased',
    mission: 'The compute engine for understanding the universe.',
    metric: '220k GPUs • ~150MW • 100% leased to Anthropic ($15B+/yr)',
    revenueNote: 'Memphis 1 site, ~220k H100/H200 GPUs. Fully leased to Anthropic from May 2026 — $1.25B/month through May 2029 ($40B+ total contract). Originally trained Grok 1 through Grok 3.',
    assists: [
      { target: 'anthropic', description: 'Anthropic took 100% of Colossus 1 capacity at $1.25B/mo through May 2029.' }
    ]
  },
  {
    id: 'xai-colossus-2',
    label: 'Colossus 2 (Memphis 2)',
    type: 'sub',
    group: 'xai',
    valuationB: 88, // ~35% of xAI — the new flagship
    val: 1.34, // sqrt(0.35) * 2.27
    short: 'New Memphis flagship • 555k→1M Blackwell GPUs • 2GW',
    mission: 'A million-GPU cluster for the next generation of Grok and orbital deployment.',
    metric: '555k Blackwell GPUs (Jan 2026) • $18B+ capex • 2GW gas + Megapack',
    revenueNote: 'Tulane Rd Memphis site, separate from Colossus 1. 2GW on-site gas generation + Tesla Megapacks. SpaceX bankrolling expansion post-merger. Training Grok 5 (6T-param MoE) and underpinning Project Celestia orbital DCs.',
    assists: []
  },
  {
    id: 'xai-grok',
    label: 'Grok',
    type: 'sub',
    group: 'xai',
    valuationB: 50, // ~20% of xAI — the LLM product
    val: 1.02, // sqrt(0.20) * 2.27
    short: 'Grok 4.3 flagship • Grok 5 (6T MoE) in training',
    mission: 'Maximum truth-seeking AI with a rebellious streak.',
    metric: 'Grok 4.3 May 2026 • 1M context • Native video • Grok 5 Q2 2026',
    revenueNote: 'API + consumer SuperGrok + Grok Business ($30/seat) + Grok Enterprise + Federal (GSA $0.42/agency, $200M DoD ceiling). Grok 4.3 (May 2026): 1M context, native video, $1.25/Mtok input. Grok 5 (6T MoE) training on Colossus 2. Shipped into Tesla vehicles globally April 2026.',
    assists: []
  },
  {
    id: 'xai-grok-imagine',
    label: 'Grok Imagine + Voice',
    type: 'sub',
    group: 'xai',
    valuationB: 38, // ~15% of xAI — multimodal product line
    val: 0.88, // sqrt(0.15) * 2.27
    short: 'Image/video gen • Agent Mode • Voice cloning',
    mission: 'Multimodal Grok across image, video, voice, and agents.',
    metric: 'Imagine Agent Mode (beta) • Custom Voices in TTS + Voice Agent APIs',
    revenueNote: 'Grok Imagine: image+video gen with Agent Mode beta and infinite canvas workspace. Grok Voice: custom voice cloning shipping in TTS + Voice Agent APIs. Bundled in SuperGrok consumer + sold a la carte to enterprise.',
    assists: []
  },

  // === NEURALINK SUB-WEBS (sized as share of $14B value) ===
  {
    id: 'nlink-telepathy',
    label: 'Telepathy (N1)',
    type: 'sub',
    group: 'neuralink',
    valuationB: 7.7, // ~55% of Neuralink
    val: 0.65, // sqrt(0.55) * 0.87
    short: 'Wireless motor-cortex BCI for cursor/keyboard control',
    mission: 'Restore digital communication for paralysis patients.',
    metric: '21 PRIME patients • Up to ~140 wpm typing',
    revenueNote: 'Original Neuralink product — N1 wireless implant in motor cortex. Patients control cursors, type, and play games at competitive speeds with thought alone. Patient experience now uses Grok to suggest replies.',
    assists: []
  },
  {
    id: 'nlink-voice',
    label: 'VOICE',
    type: 'sub',
    group: 'neuralink',
    valuationB: 2.1, // ~15%
    val: 0.34, // sqrt(0.15) * 0.87
    short: 'Speech-restoration trial — reading speech-production cortex',
    mission: 'Restore spoken communication for patients with ALS, stroke.',
    metric: 'Trial launched 2026 • Targeting 140 wpm conversational speech',
    revenueNote: 'First human VOICE participants implanted in 2026. Reads speech-production cortex and decodes intended speech. Distinct from Telepathy — different cortex region, different target population.',
    assists: []
  },
  {
    id: 'nlink-blindsight',
    label: 'Blindsight',
    type: 'sub',
    group: 'neuralink',
    valuationB: 2.8, // ~20%
    val: 0.39, // sqrt(0.20) * 0.87
    short: 'Visual-cortex microelectrode array for the blind',
    mission: 'Restore vision (and eventually exceed natural sight).',
    metric: 'FDA Breakthrough Device Designation • First human implant targeted 2026',
    revenueNote: 'Visual cortex implant bypasses damaged optic nerves. FDA Breakthrough Device Designation. Initial resolution low-pixel but improving; long-term goal to exceed natural vision via IR / multi-spectral input.',
    assists: []
  },
  {
    id: 'nlink-r1',
    label: 'R1 Surgical Robot',
    type: 'sub',
    group: 'neuralink',
    valuationB: 1.4, // ~10%
    val: 0.28, // sqrt(0.10) * 0.87
    short: 'Automated implantation robot',
    mission: 'Make BCI implantation safe, fast, and reproducible.',
    metric: 'Near-fully automated • Reaches any brain region',
    revenueNote: 'R1 surgical robot threads electrode "threads" with micron precision into target cortex regions. Now near-fully automated; can reach any brain region opening pathways for Parkinson\'s, epilepsy, depression in future indications.',
    assists: []
  },

  // === X SUB-WEBS (sized as share of $45B value) ===
  {
    id: 'x-ads',
    label: 'X Ads',
    type: 'sub',
    group: 'x',
    valuationB: 25, // ~55% — still the core business
    val: 0.95, // sqrt(0.55) * 1.28
    short: 'Core ad business: feed, video pre-roll (Amplify), Takeover',
    mission: 'Monetize the public square.',
    metric: '~$3B 2025 run-rate • $750M Q1 2026',
    revenueNote: 'Brand and direct-response advertising across the X feed plus video pre-roll (Amplify) and Takeover formats. CPMs still soft at ~$5.42 but recovering. Largest single X revenue driver.',
    assists: []
  },
  {
    id: 'x-premium',
    label: 'X Premium / Premium+',
    type: 'sub',
    group: 'x',
    valuationB: 9, // ~20%
    val: 0.57, // sqrt(0.20) * 1.28
    short: 'Subscription tiers bundling no-ads, Grok, creator tools',
    mission: 'A premium experience for X power-users.',
    metric: '14.2M subs (4.7M Premium+) • ~$1.7B ARR',
    revenueNote: 'Premium / Premium+ tiers at $8 / $16 / $40-Premium+. Grew 38% YoY to 14.2M paying users with 4.7M on Premium+. Bundles ad-free experience, Grok access, creator monetization, and longer videos.',
    assists: []
  },
  {
    id: 'x-money',
    label: 'X Money',
    type: 'sub',
    group: 'x',
    valuationB: 7, // ~15% — big upside
    val: 0.50, // sqrt(0.15) * 1.28
    short: 'Payments + 6% APY savings • Visa rails • FDIC via Cross River',
    mission: 'Payments at the scale of the everything-app.',
    metric: 'Early public access Apr 2026 • Licensed in 40+ states',
    revenueNote: 'Entered early public access April 2026. P2P + debit card on Visa Direct rails; FDIC-insured deposits up to $250K via Cross River Bank with 6% APY. Long-term plan to add merchant payments, creator payouts, and integration with Tesla / Cybercab.',
    assists: []
  },
  {
    id: 'x-tv',
    label: 'X TV',
    type: 'sub',
    group: 'x',
    valuationB: 2.3, // ~5%
    val: 0.29, // sqrt(0.05) * 1.28
    short: 'Smart-TV app for creator video — YouTube challenger play',
    mission: 'Make X creator video first-class on the big screen.',
    metric: 'Beta on Fire TV / LG webOS / Android + Google TV',
    revenueNote: 'Smart-TV app surfacing creator video content from the X timeline. Beta-stage; positioned as a YouTube challenger play for video creators monetizing through Premium+.',
    assists: []
  },

  // === BORING COMPANY SUB-WEBS ===
  {
    id: 'boring-vegas-loop',
    label: 'Vegas Loop',
    type: 'sub',
    group: 'boring',
    valuationB: 2.8, // ~40% of Boring — most mature project
    val: 0.44, // sqrt(0.40) * 0.69
    short: '8 stations • ~130 Teslas (Model Y + Cybertruck on FSD Supervised)',
    mission: 'Solve Vegas traffic underground.',
    metric: '8 stations live • Airport Connector Q1 2026 • ~130 vehicle fleet',
    revenueNote: 'Most mature Boring project. Airport Connector tunnels finishing Q1 2026, downtown LV permit + Chinatown 3-station expansion approved Jan 2026. Long-term vision 68mi / 100 stations. Cybertrucks added to the fleet Nov 2025.',
    assists: []
  },
  {
    id: 'boring-music-city',
    label: 'Music City Loop',
    type: 'sub',
    group: 'boring',
    valuationB: 2.5, // ~35% of Boring — flagship active project
    val: 0.41, // sqrt(0.35) * 0.69
    short: 'Nashville: BNA airport → Capitol → Lower Broadway',
    mission: 'Zero-emission underground transit for Nashville.',
    metric: '~13 miles • $240-300M • Construction started Feb 2026',
    revenueNote: 'TDOT + Federal Highway approval Feb 25, 2026. Phase 1 (Capitol → BNA, ~10mi) targeted late 2026. Full route through downtown Music City Center + Lower Broadway by 2029. Fully privately funded; Prufrock-MB1 tunneling machine on-site.',
    assists: []
  },
  {
    id: 'boring-dubai-loop',
    label: 'Dubai Loop',
    type: 'sub',
    group: 'boring',
    valuationB: 1.1, // ~15% of Boring
    val: 0.27, // sqrt(0.15) * 0.69
    short: 'Dubai pilot: DIFC ↔ Dubai Mall • Full alignment 22.5km / 19 stations',
    mission: 'Bring The Boring Company to a global metro.',
    metric: 'Construction contract signed with Dubai RTA • Tunneling H2 2026',
    revenueNote: 'Pilot 6.4km / 4 stations connecting DIFC and Dubai Mall. Full long-term alignment 22.5km / 19 stations across the city. Tunneling expected to begin H2 2026 with the Prufrock-5 TBM. UAE strongly aligned with broader Musk AI / infra ambitions.',
    assists: []
  },

  // === EXTERNALS (real partners & contracts) ===
  {
    id: 'nasa',
    label: 'NASA',
    type: 'external',
    group: 'external',
    color: '#3b82f6', // NASA blue
    val: 1.55,
    short: 'Human spaceflight & exploration',
    mission: 'Explore the unknown and inspire the world.',
    metric: '~$22B in active SpaceX awards • HLS $6.9B obligated',
    revenueNote: 'Largest single customer for SpaceX: Crew Dragon, Cargo Dragon (CRS-34 May 15, 2026), Artemis HLS Starship lunar lander ($4.04B total), Cygnus resupply on Falcon 9. March 2026 OIG report flagged HLS schedule slippage, est. $18.3B total through FY2030.',
    assists: []
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    type: 'external',
    group: 'external',
    color: '#fb7185', // warm coral
    valuationB: 380,
    val: 2.61, // cbrt(380)*0.36
    short: 'Frontier AI safety-focused lab (Claude)',
    mission: 'Build reliable, interpretable, and steerable AI systems.',
    metric: '~$380B Series G (Feb 2026) • ~$14B revenue run-rate • In talks for $900B round',
    revenueNote: 'Anthropic Series G closed Feb 2026 at $380B post-money ($30B raised). In talks for a follow-on at ~$900B per Bloomberg. Took 100% of xAI\'s Colossus 1 capacity at $1.25B/month through May 2029 ($15B+/yr, $40B+ total). Also exploring orbital data center capacity.',
    assists: []
  },
  {
    id: 'global-customers',
    label: 'Global Starlink Customers',
    type: 'external',
    group: 'external',
    color: '#94a3b8', // generic slate
    val: 1.10,
    short: 'Enterprise, maritime, aviation, disaster response worldwide',
    mission: 'Connectivity everywhere on Earth.',
    metric: '>10M subscribers (Feb 2026) • Available to 3.1B people in 100+ countries',
    revenueNote: 'Doubled subscriber base in 2025; +1M subs in 53 days late 2025. T-Mobile T-Satellite (Starlink↔T-Mobile direct-to-cell) commercially live since Jul 2025. Targeting 25M total subs by year-end 2026.',
    assists: []
  },
  {
    id: 'cursor',
    label: 'Cursor',
    type: 'external',
    group: 'external',
    color: '#0ea5e9', // sky / dev-tool blue
    valuationB: 50, // in talks Apr 2026 at $50B; SpaceX acq option struck at $60B
    val: 1.33, // cbrt(50)*0.36
    short: 'AI coding IDE • Anysphere • $60B SpaceX acquisition option',
    mission: 'AI-native software development at scale.',
    metric: '~$50B in talks (Apr 2026) • $2B+ ARR (Feb 2026) • $60B SpaceX option',
    revenueNote: 'Talks to raise $2B at $50B pre-money in April 2026 (a16z + Thrive lead, Nvidia strategic). Mgmt forecasts $6B ARR by EOY 2026. SpaceX holds option to acquire Anysphere for $60B in 2026 or pay $10B for compute-only collaboration. Cursor Composer training on Colossus.',
    assists: []
  },
  {
    id: 'us-space-force',
    label: 'US Space Force / DoD',
    type: 'external',
    group: 'external',
    color: '#cbd5e1', // brushed silver
    val: 1.45,
    short: 'NSSL launches • Starshield • MILNET • Golden Dome',
    mission: 'Secure US national security operations in space.',
    metric: 'PLEO ceiling $13B (was $900M) • $714M NSSL Phase 3 Lane 2 FY26',
    revenueNote: 'Single biggest US government customer for SpaceX. $1.8B NRO classified Starshield constellation (operational since May 2024). 480-sat MILNET deployment begins mid-2026. PLEO program ceiling grew to $13B. $57M Link-182 crosslink demo award (Apr 2026). ~$2B Golden Dome AMTI tracking layer expected.',
    assists: []
  },
  {
    id: 't-mobile',
    label: 'T-Mobile',
    type: 'external',
    group: 'external',
    color: '#ec4899', // T-Mobile magenta
    valuationB: 280,
    val: 2.36, // cbrt(280)*0.36
    short: 'T-Satellite Direct-to-Cell partner with Starlink',
    mission: 'Ubiquitous cellular connectivity, including from space.',
    metric: 'T-Satellite commercial since Jul 2025 • $10-17/mo D2C pricing',
    revenueNote: 'Partnered with SpaceX/Starlink for T-Satellite Direct-to-Cell service. Live across CONUS, PR, HI, parts of AK + Canada + NZ. Supports texts, images, WhatsApp, Google Maps, X, AllTrails. AT&T and Verizon launched a competing JV May 14, 2026.',
    assists: []
  },
  {
    id: 'miami-project',
    label: 'Miami Project / Barrow',
    type: 'external',
    group: 'external',
    color: '#14b8a6', // medical teal
    val: 0.85,
    short: 'PRIME clinical trial sites (Univ. of Miami + Barrow Neurological)',
    mission: 'Translate Neuralink technology into clinical care.',
    metric: 'Two of the largest PRIME trial sites in the US',
    revenueNote: 'Miami Project to Cure Paralysis (UM Miller School) + Barrow Neurological Institute (Phoenix) are the principal US sites for Neuralink\'s PRIME study. Multiple paralyzed-veteran and ALS patient implants performed at each. International sites at UCL (London) and Toronto Western round out the trial.',
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
  { source: 'xai', target: 'xai-colossus', type: 'owns', strength: 1.0, label: 'INFRA', note: 'Colossus 1 is xAI\'s original Memphis training cluster — now fully leased to Anthropic.' },
  { source: 'xai', target: 'xai-colossus-2', type: 'owns', strength: 1.0, label: 'INFRA', note: 'Colossus 2 (Memphis 2) — new $18B+ 2GW campus, 555k→1M Blackwell GPUs. Trains Grok 5.' },
  { source: 'xai', target: 'xai-grok', type: 'owns', strength: 0.95, label: 'PRODUCT', note: 'Grok 4.3 + Grok 5 (in training). xAI\'s flagship LLM product line.' },
  { source: 'xai', target: 'xai-grok-imagine', type: 'owns', strength: 0.9, label: 'PRODUCT', note: 'Grok Imagine + Voice — multimodal product line spun out as a distinct surface.' },
  { source: 'xai', target: 'x', type: 'acquired', strength: 0.85, label: 'ACQUIRED 2025', note: 'X Corp acquired by xAI in 2025, creating deep data + distribution integration.' },
  { source: 'spacex', target: 'xai', type: 'acquired', strength: 1.0, label: 'ACQUIRED FEB 2026', note: 'SpaceX acquired xAI in Feb 2026 — largest M&A deal ever, $1.25T combined entity. Plans orbital data centers powered by Colossus.' },
  { source: 'spacex', target: 'spacex-starship', type: 'owns', strength: 1.0, label: 'PROGRAM', note: 'Starship / Super Heavy — the fully-reusable super-heavy lift system.' },
  { source: 'spacex', target: 'spacex-falcon', type: 'owns', strength: 1.0, label: 'PROGRAM', note: 'Falcon 9 / Heavy — the workhorse responsible for ~40% of all global orbital launches.' },
  { source: 'spacex', target: 'spacex-starshield', type: 'owns', strength: 1.0, label: 'PROGRAM', note: 'Starshield — classified national security variant of Starlink.' },
  { source: 'spacex', target: 'spacex-celestia', type: 'owns', strength: 1.0, label: 'PROGRAM', note: 'Project Celestia — post-xAI-merger orbital AI data centers.' },
  { source: 'tesla', target: 'tesla-semi', type: 'owns', strength: 0.85, label: 'DIVISION', note: 'Tesla Semi — Class 8 electric truck program, Nevada factory.' },
  { source: 'tesla', target: 'tesla-lithium', type: 'owns', strength: 0.85, label: 'INFRA', note: 'Corpus Christi lithium refinery — first US large-scale lithium hydroxide refinery.' },
  { source: 'tesla', target: 'tesla-ai-chips', type: 'owns', strength: 0.95, label: 'PROGRAM', note: 'AI5 / AI6 custom inference silicon for FSD, Optimus, and (via Dojo 3) space compute.' },
  { source: 'neuralink', target: 'nlink-telepathy', type: 'owns', strength: 1.0, label: 'PRODUCT', note: 'Telepathy (N1) — wireless motor-cortex BCI for paralysis patients.' },
  { source: 'neuralink', target: 'nlink-voice', type: 'owns', strength: 0.9, label: 'TRIAL', note: 'VOICE trial — speech-production cortex implant for spoken communication restoration.' },
  { source: 'neuralink', target: 'nlink-blindsight', type: 'owns', strength: 0.9, label: 'PROGRAM', note: 'Blindsight — visual cortex implant; FDA Breakthrough Device Designation.' },
  { source: 'neuralink', target: 'nlink-r1', type: 'owns', strength: 0.85, label: 'TOOL', note: 'R1 surgical robot — automated implantation across any brain region.' },
  { source: 'x', target: 'x-ads', type: 'owns', strength: 1.0, label: 'DIVISION', note: 'X Ads — core ad business: feed, video pre-roll (Amplify), Takeover.' },
  { source: 'x', target: 'x-premium', type: 'owns', strength: 1.0, label: 'DIVISION', note: 'X Premium / Premium+ subscription tiers.' },
  { source: 'x', target: 'x-money', type: 'owns', strength: 0.95, label: 'DIVISION', note: 'X Money — payments + 6% APY savings on Visa rails (Cross River Bank for FDIC).' },
  { source: 'x', target: 'x-tv', type: 'owns', strength: 0.85, label: 'PRODUCT', note: 'X TV — smart-TV app for creator video.' },
  { source: 'boring', target: 'boring-vegas-loop', type: 'owns', strength: 1.0, label: 'PROJECT', note: 'Vegas Loop — most mature Boring project; 8 stations live, Cybertruck fleet.' },
  { source: 'boring', target: 'boring-music-city', type: 'owns', strength: 1.0, label: 'PROJECT', note: 'Music City Loop — Nashville flagship under construction since Feb 2026.' },
  { source: 'boring', target: 'boring-dubai-loop', type: 'owns', strength: 1.0, label: 'PROJECT', note: 'Dubai Loop — contract signed with Dubai RTA; tunneling H2 2026.' },

  // === Power supply (provider → consumer) ===
  { source: 'tesla-energy', target: 'xai-colossus', type: 'powers', strength: 0.9, label: 'COLOSSUS 1 MEGAPACKS', note: 'Tesla Megapacks powering original 220k-GPU Memphis 1 site (~150MW).' },
  { source: 'tesla-energy', target: 'xai-colossus-2', type: 'powers', strength: 0.95, label: 'COLOSSUS 2 MEGAPACKS', note: '$506M in 2025 + $191M in 2024 of Megapacks; ~$890M total powering ~1GW Colossus 2 buildout (Memphis 2 + Southaven).' },
  { source: 'tesla-energy', target: 'spacex', type: 'powers', strength: 0.7, label: 'STARBASE MEGAPACKS', note: '$697M Tesla Megapacks 2024-25 powering Starbase launch ops + ground infrastructure.' },

  // === Hardware sales (seller → buyer) ===
  { source: 'tesla', target: 'spacex', type: 'sells-to', strength: 0.6, label: 'CYBERTRUCK FLEET', note: '$143M+ of Tesla vehicles (incl. Cybertrucks) sold to SpaceX for Starbase fleet ops.' },
  { source: 'tesla', target: 'boring', type: 'sells-to', strength: 0.7, label: 'LOOP FLEET', note: 'Model Y + Model 3 + Cybertruck fleet for Vegas / Music City / Dubai loops — ~130 vehicles in Vegas already, scaling to ~1,200 at full buildout.' },
  { source: 'tesla-optimus', target: 'spacex-starship', type: 'sells-to', strength: 0.55, label: 'MARS CARGO', note: 'Optimus humanoid robots planned as cargo on 5 uncrewed Starship V3 Mars landers in the 2026/27 window for surface infrastructure buildout.' },

  // === Service contracts (provider → customer) ===
  { source: 'spacex', target: 'nasa', type: 'contracts', strength: 0.9, label: 'DRAGON + HLS + CRS', note: 'CRS-34 launched May 15, 2026. Artemis HLS $4.04B total (Phase III + IV lunar landers). ~$22B in active SpaceX-NASA awards.' },
  { source: 'xai-colossus', target: 'anthropic', type: 'contracts', strength: 0.9, label: '$1.25B/MO LEASE', note: 'Anthropic took 100% of Colossus 1 capacity at $1.25B/month through May 2029 — $40B+ total contract value.' },
  { source: 'xai-colossus-2', target: 'anthropic', type: 'contracts', strength: 0.6, label: 'CAPACITY RAMP', note: 'Anthropic lease ramps into Colossus 2 capacity as Memphis 1 saturates.' },
  { source: 'xai-colossus-2', target: 'cursor', type: 'contracts', strength: 0.7, label: 'COMPUTE', note: 'Cursor Composer training on Colossus 2 per the SpaceX-Cursor April 2026 deal.' },
  { source: 'spacex-starlink', target: 'nasa', type: 'contracts', strength: 0.5, label: 'COMMS', note: 'Starlink provides high-bandwidth connectivity for the ISS and future deep-space missions.' },
  { source: 'spacex', target: 'cursor', type: 'contracts', strength: 0.85, label: '$60B ACQ OPTION', note: 'SpaceX has right to acquire Anysphere (Cursor) for $60B in 2026, or $10B for collaboration only. Cursor unlocks Colossus compute access.' },
  { source: 'spacex', target: 'us-space-force', type: 'contracts', strength: 0.9, label: 'NSSL + STARSHIELD', note: '$714M NSSL Phase 3 Lane 2 (FY26, 5 missions incl. NROL-86) + ~$1B Starshield SDA/USSF awards.' },
  { source: 'spacex-starshield', target: 'us-space-force', type: 'contracts', strength: 0.95, label: 'MILNET 480 SATS', note: '480-satellite MILNET constellation deployment begins mid-2026, IOC late 2027. PLEO ceiling raised to $13B.' },
  { source: 'spacex-starlink', target: 't-mobile', type: 'contracts', strength: 0.85, label: 'T-SATELLITE D2C', note: 'Starlink Direct-to-Cell powering T-Mobile T-Satellite service: $10-17/mo, live across CONUS + PR + HI + AK + NZ. 657+ D2C sats in orbit.' },
  { source: 'neuralink', target: 'miami-project', type: 'contracts', strength: 0.7, label: 'PRIME SITES', note: 'Miami Project (UM Miller School) + Barrow Neurological Institute (Phoenix) are the principal US PRIME trial sites — multiple paralyzed-veteran and ALS implants completed.' },

  // === Investment / capital flows ===
  { source: 'tesla', target: 'xai', type: 'partners', strength: 0.7, label: '$2B INVESTMENT', note: 'Tesla board approved $2B investment in xAI (Jan 2026) — capital flow from Tesla into the broader Musk AI stack.' },

  // === Data / platform (data source → consumer) ===
  { source: 'x', target: 'xai', type: 'data', strength: 0.9, label: 'TRAINING DATA + DISTRIBUTION', note: 'X is the primary real-time data source for Grok and the main surface where Grok features ship.' },
  { source: 'xai-grok', target: 'tesla', type: 'data', strength: 0.8, label: 'GROK IN-CAR', note: 'Grok rolled out to Tesla vehicles globally April 2026 (US, UK, EU, AUS, NZ). Also used internally in FSD + Cybercab development.' },
  { source: 'xai-grok', target: 'neuralink', type: 'data', strength: 0.5, label: 'PATIENT REPLIES', note: 'Grok drafts suggested replies for nonverbal Neuralink patients using the N1 implant.' },
  { source: 'spacex-celestia', target: 'xai', type: 'partners', strength: 0.75, label: 'ORBITAL COMPUTE', note: 'xAI Grok/Colossus workloads will migrate to Project Celestia orbital data centers. Aether-1 100MW module targeted late 2026.' },
  { source: 'spacex-starlink', target: 'spacex-celestia', type: 'infra', strength: 0.8, label: 'OPTICAL BACKHAUL', note: 'Starlink V3 satellites carry 1Tbps optical crosslinks providing ground backhaul for orbital AI data centers.' },

  // === Infrastructure build (builder → consumer) ===
  { source: 'boring', target: 'tesla', type: 'infra', strength: 0.55, label: 'FACTORY TUNNELS', note: 'The Boring Company built underground logistics tunnels at Giga Texas for Tesla.' },

  // === Connectivity (provider → broad market) ===
  { source: 'spacex-starlink', target: 'global-customers', type: 'partners', strength: 0.5, label: 'GLOBAL CONNECTIVITY', note: 'Enterprise, maritime, aviation, disaster response, and remote scientific outposts worldwide.' },
  { source: 'spacex-starlink', target: 'tesla', type: 'partners', strength: 0.5, label: 'SUPERCHARGER + CYBERCAB', note: 'Starlink live at Tesla Superchargers; Cybercab robotaxi testing with Starlink Mini for fleet management.' }
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

// Color helpers for groups (used in 3D + UI). Refined to maximize
// at-a-glance separation between cores — Tesla red and SpaceX orange
// are now clearly distinct, X is cyan (was pure white, which blended
// with the bright inner cores of every other orb), and externals share
// a slate base that individual external nodes can override via Node.color.
export const GROUP_COLORS: Record<Node['group'], string> = {
  tesla:     '#ef4444', // pure red — Tesla
  spacex:    '#f97316', // amber-orange — SpaceX
  xai:       '#a855f7', // vivid violet — xAI
  neuralink: '#22c55e', // electric green — Neuralink
  boring:    '#facc15', // warm gold — Boring Company
  x:         '#06b6d4', // cool cyan — X (was #ffffff, indistinguishable from inner cores)
  external:  '#94a3b8'  // slate — default external fallback
}

/** Per-external thematic colors so the externals stop reading as a
 *  generic grey blob — each gets a color tied to its domain. */
export const EXTERNAL_COLORS: Record<string, string> = {
  nasa:             '#3b82f6', // NASA blue
  anthropic:        '#fb7185', // warm coral (distinct from xAI violet)
  cursor:           '#0ea5e9', // sky / dev-tool blue
  't-mobile':       '#ec4899', // T-Mobile magenta
  'us-space-force': '#cbd5e1', // brushed-silver
  'miami-project':  '#14b8a6', // medical teal
  'global-customers': '#94a3b8', // generic slate
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
