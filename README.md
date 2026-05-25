# CONSTELLATION

**An interactive 3D spatial visualization of Elon Musk's interconnected empire.**

A living, draggable, zoomable star-constellation map built in Three.js + React showing how Tesla, SpaceX, xAI, Neuralink, X, The Boring Company — and their major revenue drivers (Optimus, Starlink, Colossus, FSD/Robotaxi, Megapack, Grok...) — weave together with real contracts, power deals, data flows, and external partners like NASA and Anthropic.

![Deep space constellation demo](https://github.com/user-attachments/assets/placeholder)

## Features

- **True 3D force-directed constellation** — d3-force-3d simulation running live at 60fps
- **Drag nodes** to manually rearrange the web; simulation continues around your changes
- **Click any node** → camera flies in, panel opens with mission, revenue breakdown, sub-webs
- **"Expand sub-webs"** — dynamically inject children (Optimus, Colossus, Starlink...) into the 3D graph with new links
- **Cross-company weaves** — every documented major relationship (Megapack → Colossus $430M+, Cybertruck fleet to SpaceX, X data → Grok, NASA Dragon contracts, Anthropic leasing Colossus, etc.)
- **External assists** — NASA (ISS + Artemis), Anthropic compute, global Starlink customers
- **Bloom + starfield** — deep-space aesthetic matching SpaceX / xAI / Tesla visual language
- **Fully keyboard & mouse** — OrbitControls, search, hotkeys (R = reset, ESC = deselect)

## Tech

- Vite + React 19 + TypeScript
- @react-three/fiber + drei + postprocessing (Bloom)
- d3-force-3d for authentic 3D force layout
- framer-motion + sonner + lucide-react
- Custom dark-space design system (no external UI libs)

## Run locally

```bash
cd musk-constellation
npm install
npm run dev
```

Open http://localhost:5173

## Live demo

**https://boorussia.github.io/musk-constellation/**

(GitHub Pages deploys the built `dist/` folder via GitHub Actions on every push to `main`.)

## Controls

| Action              | How |
|---------------------|-----|
| Rotate view         | Left drag |
| Zoom                | Scroll / pinch |
| Pan                 | Right drag or middle mouse |
| Select & focus      | Click glowing node |
| Drag nodes          | Click + hold a node sphere and move |
| Expand sub-webs     | Click "ADD SUB-WEBS TO 3D..." in panel or use top bar |
| Reset everything    | Press **R** or click RESET |
| Deselect            | ESC or click empty space |

## Data notes

All numbers, contracts, and relationships are synthesized from:
- Tesla 10-K / 10-Q + Electrek analysis (2025-26)
- SpaceX public NASA awards and Starlink subscriber reports
- xAI funding announcements + Colossus disclosures
- Neuralink patient updates
- Public X / xAI integration news

Private valuations and exact revenue splits are estimates. The map prioritizes signal over 100% precision.

## Extending the web

Edit `src/data/constellation.ts`:

- Add new `Node` entries (core / sub / external)
- Add `Link` entries with `type` (owns | powers | contracts | data | sells-to | acquired | infra | partners)
- Give nodes `children: string[]` for the expand mechanic
- Add `assists` for beautiful "outside the umbrella" stories

The simulation and UI will pick everything up automatically.

## Future ideas (PR welcome)

- URL shareable state (selected + expanded)
- Time-scrubber (historical links appearing/disappearing)
- 2D minimap / force-directed minimap
- Export high-res screenshot or video
- Mobile touch drag + pinch (OrbitControls already decent)
- More flow particles traveling along highlighted links
- Voice / LLM query mode ("show me everything that powers xAI")

Built as a love letter to the most ambitious industrial web of our time.

---

**Press R to reset. Click the stars.**
