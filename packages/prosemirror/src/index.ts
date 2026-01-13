/**
 * @threa/prosemirror - Shared ProseMirror utilities
 *
 * This package provides bidirectional conversion between Markdown text
 * and ProseMirror JSON format, ensuring consistent handling across
 * frontend (TipTap editor) and backend (AI agents, external integrators).
 */

export { serializeToMarkdown, parseMarkdown, type MentionTypeLookup, type EmojiLookup } from "./markdown"

// Re-export types for convenience
export type { JSONContent, JSONContentMark, ThreaDocument } from "@threa/types"
