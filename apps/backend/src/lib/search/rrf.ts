export interface RankedResult {
  id: string
  score: number
}

export interface RRFOptions {
  keywordWeight?: number
  semanticWeight?: number
  k?: number
}

const DEFAULT_OPTIONS: Required<RRFOptions> = {
  keywordWeight: 0.6,
  semanticWeight: 0.4,
  k: 60,
}

/**
 * Combines two ranked lists using Reciprocal Rank Fusion (RRF).
 *
 * RRF formula: score(d) = Σ(weight / (k + rank(d)))
 *
 * Higher k values reduce the impact of high-ranking documents.
 * The default k=60 is a common choice that balances influence across ranks.
 */
export function combineWithRRF<T extends { id: string }>(
  keywordResults: T[],
  semanticResults: T[],
  options: RRFOptions = {}
): T[] {
  const { keywordWeight, semanticWeight, k } = { ...DEFAULT_OPTIONS, ...options }

  const scores = new Map<string, { score: number; item: T }>()

  // Score keyword results
  keywordResults.forEach((item, index) => {
    const rank = index + 1
    const rrfScore = keywordWeight / (k + rank)
    const existing = scores.get(item.id)
    if (existing) {
      existing.score += rrfScore
    } else {
      scores.set(item.id, { score: rrfScore, item })
    }
  })

  // Score semantic results
  semanticResults.forEach((item, index) => {
    const rank = index + 1
    const rrfScore = semanticWeight / (k + rank)
    const existing = scores.get(item.id)
    if (existing) {
      existing.score += rrfScore
    } else {
      scores.set(item.id, { score: rrfScore, item })
    }
  })

  // Sort by combined score (descending)
  const combined = [...scores.values()]
  combined.sort((a, b) => b.score - a.score)

  return combined.map(({ item }) => item)
}
