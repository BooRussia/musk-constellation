// Distinct trail colors cycled across selected satellites so their
// overlapping orbit paths stay tellable apart. Shared by OrbitTrails
// (the 3D lines) and the selection panel (the swatches).
export const TRAIL_PALETTE = [
  '#42e8ff', '#ff5fa8', '#ffd23f', '#7cff6b',
  '#b89bff', '#ff9a3f', '#5fefff', '#ff6b6b',
]

/** Stable trail color for a given selection index. */
export function trailColorAt(index: number): string {
  return TRAIL_PALETTE[index % TRAIL_PALETTE.length]
}
