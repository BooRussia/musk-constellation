# Auto-update system

How the site keeps itself current — Elon-company info and launches both update
without anyone hand-editing the repo. Three layers:

## 1. Real-time in-app (client-side, no deploy needed)

These refresh live in the browser:

| Data | Source | Cadence |
| --- | --- | --- |
| Next launch, countdown, window, weather %, webcast | Launch Library 2 | adaptive poll: every **4 min** within 1h of T-0, **10 min** within 6h, else **20 min** |
| Live launch simulation | LL2 `net` + client clock | per-frame once the launch is loaded |
| Satellites (Starlink, Kuiper, ISS, …) | CelesTrak TLEs | on view open + periodic |

The launch poller (`src/components/StarlinkView.tsx`) bypasses the localStorage
cache (`fetchNextLaunchDetailed(true)` in `src/lib/launches.ts`) so it always
pulls the network copy, then **rolls over to the next launch automatically**
once one lifts off — no page reload. Cadence is capped to stay under LL2's free
≈15 req/hr ceiling.

## 2. Scheduled data refresh (CI → commit → redeploy)

`.github/workflows/refresh-data.yml` runs every 6 hours:

1. `npm run build-launches` — re-bakes `src/data/pastLaunches.json` (replay catalog).
2. `npm run build-tle` — re-bakes `public/data/tle/*.txt` (cold-start satellite fallback).
3. Commits any changes to `main`, then rebuilds + redeploys GitHub Pages.
   (Netlify rebuilds on its own from the push.)

This keeps the **static fallbacks** and the past-launch replay history fresh
even though the live feeds above already update client-side.

## 3. Company-news auto-update (AI research → reviewed PR)

`.github/workflows/refresh-companies.yml` runs weekly:

1. `npm run refresh-companies` (`scripts/refresh-companies.mjs`) calls the Claude
   API with the **web_search** tool to find recent, *verifiable* developments
   across Tesla, SpaceX, xAI, Neuralink, X, The Boring Company, Starlink, and
   Starship.
2. It merges cited headlines into `src/data/companyNews.json` (keyed by
   constellation node id).
3. The workflow opens a **pull request** — it never commits directly. A human
   confirms each headline against its source before merge, so AI-sourced facts
   never ship unvetted.

The constellation detail panel surfaces the newest items as a **LATEST** card
(`src/lib/companyNews.ts` → `App.tsx`).

### Setup for layer 3

In the GitHub repo:

1. Add secret `ANTHROPIC_API_KEY` (Settings → Secrets and variables → Actions).
2. Enable Settings → Actions → "Allow GitHub Actions to create and approve pull
   requests".

Without the secret the script is a safe no-op (exits 0, opens no PR). Model is
`claude-opus-4-8` by default; override with the `MODEL` env var.

### Why companies are PR-gated but launches/TLEs aren't

Launch and orbital data come from authoritative, structured feeds (LL2,
CelesTrak) — safe to auto-commit. Company "news" is synthesized from open-web
search, so it goes through human review to avoid publishing unverified claims.
