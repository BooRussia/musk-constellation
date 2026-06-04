// ============================================
// ISS occupancy + docked-vehicle status (curated)
// ============================================
// The station's live POSITION comes from its CelesTrak TLE (see
// fetchISS) — accurate and self-updating. But there is no clean public
// feed for "who's aboard" or "which Dragon is docked right now", so that
// context is hand-maintained here with an `asOf` stamp. Refresh it when
// a Crew Dragon docks/undocks (roughly every ~6 months).

export interface DockedDragon {
  /** Mission name, e.g. "SpaceX Crew-12". */
  mission: string
  /** Capsule name, e.g. "Crew Dragon Freedom". */
  capsule: string
  kind: 'Crew' | 'Cargo'
  /** Astronauts aboard (Crew missions). */
  crew: string[]
  /** ISO date the capsule docked. */
  dockedSince: string
}

export interface ISSStatus {
  /** Current ISS expedition label. */
  expedition: string
  /** Dragons currently docked (usually 0–1 crewed + maybe a cargo). */
  dragons: DockedDragon[]
  /** Date this snapshot was last verified. */
  asOf: string
}

export const ISS_STATUS: ISSStatus = {
  expedition: 'Expedition 74 / 75',
  dragons: [
    {
      mission: 'SpaceX Crew-12',
      capsule: 'Crew Dragon Freedom',
      kind: 'Crew',
      crew: ['Jessica Meir', 'Jack Hathaway', 'Sophie Adenot', 'Andrey Fedyaev'],
      dockedSince: '2026-02-15',
    },
  ],
  asOf: '2026-06-04',
}

/** The crewed Dragon currently docked, if any (drives the "+ Crew Dragon"
 *  badge on the live marker). */
export const DOCKED_CREW_DRAGON: DockedDragon | null =
  ISS_STATUS.dragons.find((d) => d.kind === 'Crew') ?? null
