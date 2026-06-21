// ============================================
// refresh-companies.mjs — auto-update the per-company "Latest" news feed
// ============================================
// Uses the Claude API with the web_search server tool to research the most
// recent, *verifiable* developments across Elon Musk's companies, then merges
// them into src/data/companyNews.json (keyed by constellation node id). The
// constellation detail panel surfaces these as the "LATEST" card.
//
// This is the "auto-update company info as it becomes available" half of the
// system. It runs on a cron in CI (.github/workflows/refresh-companies.yml)
// and opens a PULL REQUEST rather than committing directly — a human reviews
// the AI-sourced facts before they go live, so unverified claims never ship.
//
// Safe no-op without setup:
//   • no ANTHROPIC_API_KEY  → logs and exits 0 (no file change)
//   • @anthropic-ai/sdk not installed → logs and exits 0
//
// Run locally:  ANTHROPIC_API_KEY=sk-... node scripts/refresh-companies.mjs
// Model override: MODEL=claude-sonnet-4-6 node scripts/refresh-companies.mjs

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const DATA_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'companyNews.json')
const MODEL = process.env.MODEL || 'claude-opus-4-8'
const MAX_PER_COMPANY = 4
const MAX_CONTINUATIONS = 8 // server-tool (web_search) pause_turn resumes

// Constellation node id → company name. Keep ids in sync with
// src/data/constellation.ts (core company nodes + notable subs/externals).
const COMPANIES = [
  { id: 'tesla', name: 'Tesla' },
  { id: 'spacex', name: 'SpaceX' },
  { id: 'xai', name: 'xAI (incl. Grok)' },
  { id: 'neuralink', name: 'Neuralink' },
  { id: 'x', name: 'X (formerly Twitter)' },
  { id: 'boring', name: 'The Boring Company' },
  { id: 'spacex-starlink', name: 'Starlink' },
  { id: 'spacex-starship', name: 'SpaceX Starship / Super Heavy' },
]

function buildPrompt(todayISO) {
  const list = COMPANIES.map((c) => `- "${c.id}": ${c.name}`).join('\n')
  return `Today is ${todayISO}. Research the most significant, RECENT, and VERIFIABLE developments (roughly the last 6 months) for each of these Elon Musk companies. Use web search and rely only on what you can confirm from a real, reputable source with a working URL.

Companies (use the quoted id as the JSON key):
${list}

Requirements:
- For each company, return up to ${MAX_PER_COMPANY} items, newest first.
- Each item: a concise factual headline (<= 120 chars, no hype), an ISO date (YYYY-MM-DD) of the event, a "source" (publication name), and a "url" (the article you verified it from).
- Only include items you actually verified from search results. If you cannot verify recent news for a company, return an empty array for it — do NOT guess, speculate, or include rumors/unconfirmed reports.
- No duplicates; prefer concrete milestones (launches, products, funding, regulatory, financials) over vague "continues to..." statements.

Output ONLY a single JSON object in a fenced code block, exactly this shape and nothing else after it:

\`\`\`json
{
  "companies": {
    "tesla": [ { "headline": "...", "date": "YYYY-MM-DD", "source": "...", "url": "https://..." } ],
    "spacex": [],
    "...": []
  }
}
\`\`\``
}

/** Pull the last ```json fenced block (or any {...}) out of the model text. */
function parseModelJson(text) {
  const fence = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)]
  const candidate = fence.length ? fence[fence.length - 1][1] : text
  try {
    return JSON.parse(candidate)
  } catch {
    // last resort: grab the outermost object
    const s = candidate.indexOf('{')
    const e = candidate.lastIndexOf('}')
    if (s >= 0 && e > s) return JSON.parse(candidate.slice(s, e + 1))
    throw new Error('Could not parse JSON from model output')
  }
}

function isValidItem(it) {
  return (
    it &&
    typeof it.headline === 'string' &&
    it.headline.trim().length > 0 &&
    typeof it.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(it.date)
  )
}

function cleanItem(it) {
  const out = { headline: it.headline.trim(), date: it.date }
  if (typeof it.source === 'string' && it.source.trim()) out.source = it.source.trim()
  if (typeof it.url === 'string' && /^https?:\/\//.test(it.url.trim())) out.url = it.url.trim()
  if (typeof it.detail === 'string' && it.detail.trim()) out.detail = it.detail.trim()
  return out
}

async function loadAnthropic() {
  try {
    const mod = await import('@anthropic-ai/sdk')
    return mod.default
  } catch {
    return null
  }
}

async function research(Anthropic, todayISO) {
  const client = new Anthropic()
  const tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 12 }]
  const messages = [{ role: 'user', content: buildPrompt(todayISO) }]

  let response
  for (let i = 0; i < MAX_CONTINUATIONS; i++) {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      tools,
      messages,
    })
    if (response.stop_reason === 'refusal') {
      throw new Error('Model refused the research request')
    }
    if (response.stop_reason !== 'pause_turn') break
    // Server tool hit its iteration cap — resume by echoing the turn back.
    messages.push({ role: 'assistant', content: response.content })
  }

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
  return parseModelJson(text)
}

function mergeCompanies(existing, fresh) {
  const out = { ...existing }
  for (const { id } of COMPANIES) {
    const items = (fresh?.companies?.[id] ?? []).filter(isValidItem).map(cleanItem)
    if (items.length === 0) continue // keep whatever we already had for this id
    const byHeadline = new Map()
    for (const it of items) byHeadline.set(it.headline.toLowerCase(), it)
    out[id] = [...byHeadline.values()]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, MAX_PER_COMPANY)
  }
  return out
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('No ANTHROPIC_API_KEY set — skipping company-news refresh (no-op).')
    return
  }
  const Anthropic = await loadAnthropic()
  if (!Anthropic) {
    console.log('@anthropic-ai/sdk not installed — skipping company-news refresh (no-op).')
    return
  }

  const todayISO = new Date().toISOString().slice(0, 10)
  const current = JSON.parse(await readFile(DATA_PATH, 'utf8'))

  let fresh
  try {
    fresh = await research(Anthropic, todayISO)
  } catch (err) {
    console.error('Research failed:', err.message)
    process.exitCode = 1
    return
  }

  const mergedCompanies = mergeCompanies(current.companies || {}, fresh)
  const next = {
    generatedAt: todayISO,
    source: 'auto',
    note: current.note,
    companies: mergedCompanies,
  }

  const before = JSON.stringify(current)
  const after = JSON.stringify(next)
  if (before === after) {
    console.log('Company news unchanged.')
    return
  }

  await writeFile(DATA_PATH, JSON.stringify(next, null, 2) + '\n')
  const counts = Object.entries(mergedCompanies)
    .map(([id, v]) => `${id}:${v.length}`)
    .join(' ')
  console.log(`Updated ${DATA_PATH}\n  ${counts}`)
}

main()
