/**
 * Parse and serialize search queries with filter support.
 *
 * Supports filters: from:@user, with:@user, in:#channel, in:@user (DM), is:type, after:date, before:date
 */

export type FilterType = "from" | "with" | "in" | "is" | "after" | "before"

export interface ParsedFilter {
  type: FilterType
  value: string
  /** Original text in the query (e.g., "from:@martin") */
  raw: string
}

export interface ParsedQuery {
  filters: ParsedFilter[]
  text: string
}

/**
 * Parse a search query string into filters and remaining text.
 *
 * Examples:
 * - "from:@martin hello" → { filters: [{type: "from", value: "martin"}], text: "hello" }
 * - "in:#general is:thread" → { filters: [{type: "in", value: "general"}, {type: "is", value: "thread"}], text: "" }
 */
export function parseSearchQuery(query: string): ParsedQuery {
  const filters: ParsedFilter[] = []
  const parts: string[] = []

  // Match filter patterns: from:@slug, with:@slug, in:#slug, in:@slug, is:type, after:date, before:date
  // Using regex to find all filters while preserving order
  const filterRegex = /\b(from:@|with:@|in:#|in:@|is:|after:|before:)(\S*)/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = filterRegex.exec(query)) !== null) {
    // Add text before this filter
    if (match.index > lastIndex) {
      parts.push(query.slice(lastIndex, match.index))
    }

    const [raw, prefix, value] = match
    const type = extractFilterType(prefix)

    if (type && value) {
      filters.push({ type, value, raw })
    } else {
      // Invalid filter syntax, treat as text
      parts.push(raw)
    }

    lastIndex = match.index + raw.length
  }

  // Add remaining text
  if (lastIndex < query.length) {
    parts.push(query.slice(lastIndex))
  }

  // Clean up text: join parts and normalize whitespace
  const text = parts.join("").trim().replace(/\s+/g, " ")

  return { filters, text }
}

function extractFilterType(prefix: string): FilterType | null {
  switch (prefix) {
    case "from:@":
      return "from"
    case "with:@":
      return "with"
    case "in:#":
    case "in:@":
      return "in"
    case "is:":
      return "is"
    case "after:":
      return "after"
    case "before:":
      return "before"
    default:
      return null
  }
}

/**
 * Build a search query string from filters and text.
 */
export function buildSearchQuery(filters: ParsedFilter[], text: string): string {
  const filterParts = filters.map((f) => f.raw)
  const parts = [...filterParts]

  if (text.trim()) {
    parts.push(text.trim())
  }

  return parts.join(" ")
}

/**
 * Remove a filter from the query string.
 */
export function removeFilterFromQuery(query: string, filterIndex: number): string {
  const { filters, text } = parseSearchQuery(query)
  const newFilters = filters.filter((_, i) => i !== filterIndex)
  return buildSearchQuery(newFilters, text)
}

/**
 * Add a filter to the query string.
 */
export function addFilterToQuery(query: string, type: FilterType, value: string): string {
  const { filters, text } = parseSearchQuery(query)

  // Determine the raw format based on filter type
  let raw: string
  switch (type) {
    case "from":
      raw = `from:@${value}`
      break
    case "with":
      raw = `with:@${value}`
      break
    case "in":
      // Determine if it's a channel or user based on value prefix or content
      raw = value.startsWith("#") ? `in:${value}` : `in:@${value}`
      break
    case "is":
      raw = `is:${value}`
      break
    case "after":
      raw = `after:${value}`
      break
    case "before":
      raw = `before:${value}`
      break
  }

  const newFilter: ParsedFilter = { type, value, raw }
  return buildSearchQuery([...filters, newFilter], text)
}

/**
 * Get display label for a filter value.
 */
export function getFilterLabel(filter: ParsedFilter): string {
  switch (filter.type) {
    case "from":
      return `@${filter.value}`
    case "with":
      return `@${filter.value}`
    case "in":
      return filter.raw.startsWith("in:#") ? `#${filter.value}` : `@${filter.value}`
    case "is":
      return filter.value
    case "after":
      return `after ${filter.value}`
    case "before":
      return `before ${filter.value}`
  }
}
