import { STREAM_TYPES, type StreamType } from "@threa/types"

export interface SearchFilters {
  from?: string[]
  with?: string[]
  in?: string[]
  is?: StreamType[]
  before?: Date
  after?: Date
}

export interface ParsedQuery {
  terms: string
  filters: SearchFilters
}

const FILTER_PATTERNS = {
  from: /from:@(\S+)/gi,
  with: /with:@(\S+)/gi,
  in: /in:#(\S+)/gi,
  is: /is:(\S+)/gi,
  before: /before:(\S+)/gi,
  after: /after:(\S+)/gi,
} as const

function parseDate(value: string): Date | null {
  const date = new Date(value)
  return isNaN(date.getTime()) ? null : date
}

function isValidStreamType(value: string): value is StreamType {
  return (STREAM_TYPES as readonly string[]).includes(value)
}

export function parseQuery(query: string): ParsedQuery {
  const filters: SearchFilters = {}
  let remaining = query

  // Extract from:@user
  const fromMatches = [...remaining.matchAll(FILTER_PATTERNS.from)]
  if (fromMatches.length > 0) {
    filters.from = fromMatches.map((m) => m[1].toLowerCase())
    remaining = remaining.replace(FILTER_PATTERNS.from, "")
  }

  // Extract with:@user
  const withMatches = [...remaining.matchAll(FILTER_PATTERNS.with)]
  if (withMatches.length > 0) {
    filters.with = withMatches.map((m) => m[1].toLowerCase())
    remaining = remaining.replace(FILTER_PATTERNS.with, "")
  }

  // Extract in:#channel
  const inMatches = [...remaining.matchAll(FILTER_PATTERNS.in)]
  if (inMatches.length > 0) {
    filters.in = inMatches.map((m) => m[1].toLowerCase())
    remaining = remaining.replace(FILTER_PATTERNS.in, "")
  }

  // Extract is:type
  const isMatches = [...remaining.matchAll(FILTER_PATTERNS.is)]
  if (isMatches.length > 0) {
    const validTypes = isMatches.map((m) => m[1].toLowerCase()).filter(isValidStreamType)
    if (validTypes.length > 0) {
      filters.is = validTypes
    }
    remaining = remaining.replace(FILTER_PATTERNS.is, "")
  }

  // Extract before:date
  const beforeMatches = [...remaining.matchAll(FILTER_PATTERNS.before)]
  if (beforeMatches.length > 0) {
    const date = parseDate(beforeMatches[0][1])
    if (date) {
      filters.before = date
    }
    remaining = remaining.replace(FILTER_PATTERNS.before, "")
  }

  // Extract after:date
  const afterMatches = [...remaining.matchAll(FILTER_PATTERNS.after)]
  if (afterMatches.length > 0) {
    const date = parseDate(afterMatches[0][1])
    if (date) {
      filters.after = date
    }
    remaining = remaining.replace(FILTER_PATTERNS.after, "")
  }

  // Clean up remaining text (remove extra whitespace)
  const terms = remaining.replace(/\s+/g, " ").trim()

  return { terms, filters }
}
