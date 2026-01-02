/**
 * Types for search query parsing and serialization.
 *
 * Query strings like "from:@martin in:#general is:thread restaurants"
 * are parsed into a sequence of nodes for display in TipTap editor,
 * and serialized back to strings for API calls.
 */

export type FilterType = "from" | "with" | "in" | "type" | "status" | "after" | "before"

/**
 * A filter node represents a search filter like "from:@martin".
 * - filterType: the type of filter (from, with, in, is, after, before)
 * - value: the filter value including any prefix (@, #) e.g. "@martin", "#general", "thread"
 * - resolvedId: optional ID for resolved mentions/channels (for API calls)
 */
export interface FilterNode {
  type: "filter"
  filterType: FilterType
  value: string
  resolvedId?: string
}

/**
 * A text node represents plain text in the query.
 * This is used for:
 * - Free text search terms like "restaurants"
 * - Standalone @mentions that are search terms, not filters (e.g. "@martin" alone)
 * - Quoted strings that should be treated literally
 */
export interface TextNode {
  type: "text"
  text: string
  isQuoted?: boolean
}

export type QueryNode = FilterNode | TextNode

/**
 * Represents a parsed query as a sequence of nodes.
 */
export type ParsedQuery = QueryNode[]
