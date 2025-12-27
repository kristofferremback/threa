/**
 * Base interface for mentionable entities (users, personas, broadcast).
 */
export interface Mentionable {
  id: string
  slug: string
  name: string
  type: "user" | "persona" | "broadcast"
  avatarEmoji?: string
  avatarUrl?: string
  /** True if this is the current user */
  isCurrentUser?: boolean
}

/**
 * Interface for channel/stream links.
 */
export interface ChannelItem {
  id: string
  slug: string
  name: string
  type: "channel" | "scratchpad"
  memberCount?: number
}

/**
 * Interface for slash commands.
 */
export interface CommandItem {
  name: string
  description: string
  category?: string
}

/**
 * Suggestion state passed to the popup component.
 */
export interface SuggestionState<T> {
  items: T[]
  query: string
  selectedIndex: number
  clientRect: (() => DOMRect | null) | null
}

/**
 * Command interface for controlling the suggestion popup from TipTap.
 */
export interface SuggestionCommand<T> {
  items: T[]
  query: string
  range: Range
  clientRect: (() => DOMRect | null) | null
}
