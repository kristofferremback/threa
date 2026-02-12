import { buildQueryVariants } from "./query-variants"

export interface BaselineQuery {
  target: "memos" | "messages" | "attachments"
  type: "semantic" | "exact"
  query: string
}

export function buildBaselineQueries(message: string): BaselineQuery[] {
  const variants = buildQueryVariants(message)
  if (variants.length === 0) {
    return []
  }
  const primaryQuery = variants[0]
  const additionalQueries = variants.slice(1, 5)

  const baselineQueries: BaselineQuery[] = [
    {
      target: "memos",
      type: "semantic",
      query: primaryQuery,
    },
    {
      target: "messages",
      type: "semantic",
      query: primaryQuery,
    },
    {
      target: "messages",
      type: "exact",
      query: primaryQuery,
    },
  ]

  for (const query of additionalQueries) {
    baselineQueries.push({
      target: "messages",
      type: "exact",
      query,
    })
  }

  return baselineQueries
}

export function appendBaselineQueries<T extends BaselineQuery>(existing: T[], message: string): T[] {
  const merged: T[] = [...existing]
  const seen = new Set(merged.map((query) => `${query.target}|${query.type}|${query.query}`))

  for (const query of buildBaselineQueries(message)) {
    const key = `${query.target}|${query.type}|${query.query}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    merged.push(query as T)
  }

  return merged
}
