// ============================================
// Company news feed — auto-updated "Latest" headlines per company
// ============================================
// Backed by src/data/companyNews.json, which a scheduled GitHub Action
// (scripts/refresh-companies.mjs + .github/workflows/refresh-companies.yml)
// regenerates from web search and opens as a reviewable PR. The constellation
// detail panel reads this to show the freshest development on a company without
// anyone hand-editing the core curated data. Keyed by constellation node id.

import data from '../data/companyNews.json'

export interface CompanyNewsItem {
  /** One-line development (≤ ~120 chars). */
  headline: string
  /** ISO date the development happened (YYYY-MM-DD). */
  date: string
  /** Source link, if the item came from a cited article. */
  url?: string
  /** Publication / source name, e.g. "Reuters". */
  source?: string
  /** Optional extra sentence of context. */
  detail?: string
}

interface CompanyNewsFile {
  generatedAt: string
  source?: string
  note?: string
  companies: Record<string, CompanyNewsItem[]>
}

const file = data as CompanyNewsFile

/** When the feed was last regenerated (YYYY-MM-DD). */
export const newsGeneratedAt = file.generatedAt

/** Most-recent first, capped at `limit`, for a given constellation node id. */
export function getCompanyNews(nodeId: string, limit = 3): CompanyNewsItem[] {
  const items = file.companies[nodeId]
  if (!items || items.length === 0) return []
  return [...items]
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .slice(0, limit)
}
