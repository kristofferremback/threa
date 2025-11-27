/**
 * Search Query Parser
 *
 * Parses Slack-like search syntax:
 * - from:@username - messages from a user
 * - in:#channel - messages in a channel/stream
 * - before:YYYY-MM-DD - messages before date
 * - after:YYYY-MM-DD - messages after date
 * - has:code - messages containing code blocks
 * - has:link - messages containing links
 * - is:thread - thread root messages
 * - is:knowledge - search knowledge base only
 *
 * Free text is used for semantic + full-text search.
 */

export interface SearchFilters {
  from?: string[] // user IDs or handles (without @)
  in?: string[] // stream slugs or IDs (without #)
  before?: Date
  after?: Date
  has?: ("code" | "link")[]
  is?: ("thread" | "knowledge")[]
}

export interface ParsedSearch {
  filters: SearchFilters
  freeText: string
}

/**
 * Parse a search query string into filters and free text.
 */
export function parseSearchQuery(query: string): ParsedSearch {
  const filters: SearchFilters = {}
  let remaining = query

  // from:@username or from:username
  const fromMatches = [...remaining.matchAll(/from:@?(\w+)/gi)]
  for (const match of fromMatches) {
    filters.from = filters.from || []
    filters.from.push(match[1].toLowerCase())
    remaining = remaining.replace(match[0], "")
  }

  // in:#channel or in:channel
  const inMatches = [...remaining.matchAll(/in:#?([\w-]+)/gi)]
  for (const match of inMatches) {
    filters.in = filters.in || []
    filters.in.push(match[1].toLowerCase())
    remaining = remaining.replace(match[0], "")
  }

  // before:YYYY-MM-DD
  const beforeMatch = remaining.match(/before:(\d{4}-\d{2}-\d{2})/i)
  if (beforeMatch) {
    const date = new Date(beforeMatch[1])
    if (!isNaN(date.getTime())) {
      filters.before = date
    }
    remaining = remaining.replace(beforeMatch[0], "")
  }

  // after:YYYY-MM-DD
  const afterMatch = remaining.match(/after:(\d{4}-\d{2}-\d{2})/i)
  if (afterMatch) {
    const date = new Date(afterMatch[1])
    if (!isNaN(date.getTime())) {
      filters.after = date
    }
    remaining = remaining.replace(afterMatch[0], "")
  }

  // has:code, has:link
  const hasMatches = [...remaining.matchAll(/has:(code|link)/gi)]
  for (const match of hasMatches) {
    filters.has = filters.has || []
    const value = match[1].toLowerCase() as "code" | "link"
    if (!filters.has.includes(value)) {
      filters.has.push(value)
    }
    remaining = remaining.replace(match[0], "")
  }

  // is:thread, is:knowledge
  const isMatches = [...remaining.matchAll(/is:(thread|knowledge)/gi)]
  for (const match of isMatches) {
    filters.is = filters.is || []
    const value = match[1].toLowerCase() as "thread" | "knowledge"
    if (!filters.is.includes(value)) {
      filters.is.push(value)
    }
    remaining = remaining.replace(match[0], "")
  }

  // Clean up remaining text
  const freeText = remaining.replace(/\s+/g, " ").trim()

  return { filters, freeText }
}

/**
 * Build a display string from filters for UI.
 */
export function filtersToDisplay(filters: SearchFilters): string {
  const parts: string[] = []

  if (filters.from?.length) {
    parts.push(`from: ${filters.from.map((f) => `@${f}`).join(", ")}`)
  }
  if (filters.in?.length) {
    parts.push(`in: ${filters.in.map((c) => `#${c}`).join(", ")}`)
  }
  if (filters.before) {
    parts.push(`before: ${filters.before.toISOString().slice(0, 10)}`)
  }
  if (filters.after) {
    parts.push(`after: ${filters.after.toISOString().slice(0, 10)}`)
  }
  if (filters.has?.length) {
    parts.push(`has: ${filters.has.join(", ")}`)
  }
  if (filters.is?.length) {
    parts.push(`is: ${filters.is.join(", ")}`)
  }

  return parts.join(" • ")
}

/**
 * Check if filters have any active conditions.
 */
export function hasActiveFilters(filters: SearchFilters): boolean {
  return !!(
    filters.from?.length ||
    filters.in?.length ||
    filters.before ||
    filters.after ||
    filters.has?.length ||
    filters.is?.length
  )
}

