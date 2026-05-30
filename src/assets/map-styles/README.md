# Map styles — drop your stylized Earth maps here 🌍

Drop image files into **this folder** (`src/assets/map-styles/`) and they
automatically appear in the **Map style** dropdown on the Starlink view.
No code changes needed — commit + push and they go live.

## Requirements

- **Format:** `.jpg`, `.jpeg`, `.png`, or `.webp`
- **Projection:** equirectangular (a flat world map), **2:1 aspect ratio**
  (e.g. 8192×4096, 5400×2700, 4096×2048). This is the standard "unwrapped
  globe" layout — the left edge is 180°W, the right edge is 180°E, the
  middle is the prime meridian, top is the north pole, bottom is the south.
- **Size:** 4K–8K wide looks best. Keep files reasonable (JPG/WebP, < ~10 MB).

## Naming → dropdown label

The filename becomes the label, auto-prettified:

| filename                | dropdown label   |
| ----------------------- | ---------------- |
| `watercolor.jpg`        | Watercolor       |
| `neon-grid.png`         | Neon Grid        |
| `01-blue-marble.webp`   | Blue Marble (the leading `01-` just controls sort order) |

## How they're rendered

By default a dropped map is shown **faithfully** (the whole image, exactly
as drawn) with only the real-time day/night terminator shading on top — no
procedural ocean recolor, no Earth city lights (those assume the real
coastlines, so they'd clash with stylized art).

If a map you drop in is actually a **realistic** Earth photo (real
coastlines) and you want the full treatment (animated ocean + night-city
lights + relief), tell me the filename and I'll flag it `realistic` in
`src/data/mapStyles.ts` (there's an `OVERRIDES` map for exactly this).

The built-in **Photoreal Earth** is always the first option and is
unaffected by anything you drop here.
