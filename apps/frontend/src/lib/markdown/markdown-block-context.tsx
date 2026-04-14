import { createContext, useContext, type ReactNode } from "react"

/**
 * Kinds of collapsible markdown blocks we track collapse state for.
 * New kinds should be added here and surfaced in `hashMarkdownBlock` callers.
 */
export type MarkdownBlockKind = "code" | "blockquote" | "quote-reply"

/**
 * Scopes markdown blocks (code blocks, blockquotes, quote replies) to a
 * specific message id so each block's user-toggled collapse state can be
 * persisted per-message.
 *
 * We identify individual blocks by a hash of their content + namespace rather
 * than positional index: the hash is stable across re-renders and across
 * Suspense boundaries, and avoids coupling state to the exact order in which
 * react-markdown walks the tree. Two identical blocks in a single message
 * sharing state is an acceptable edge case.
 */
interface MarkdownBlockContextValue {
  messageId: string
}

const MarkdownBlockContext = createContext<MarkdownBlockContextValue | null>(null)

interface MarkdownBlockProviderProps {
  messageId: string
  children: ReactNode
}

export function MarkdownBlockProvider({ messageId, children }: MarkdownBlockProviderProps) {
  return <MarkdownBlockContext.Provider value={{ messageId }}>{children}</MarkdownBlockContext.Provider>
}

export function useMarkdownBlockContext(): MarkdownBlockContextValue | null {
  return useContext(MarkdownBlockContext)
}

/**
 * Fast deterministic hash of content using the DJB2 algorithm.
 * Output is a base-36 unsigned 32-bit integer — short, URL-safe, and
 * stable across platforms. Not cryptographic; just enough to identify
 * blocks within a single message.
 *
 * `namespace` separates hash spaces between block kinds so an identical
 * content string in a code block and a blockquote get different hashes
 * (e.g. pass the source language for code, or the block kind otherwise).
 */
export function hashMarkdownBlock(content: string, namespace: string): string {
  const input = `${namespace}\u0000${content}`
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i)
    // Clamp to 32 bits so the shift doesn't produce floats.
    hash |= 0
  }
  return (hash >>> 0).toString(36)
}

/**
 * Compose the IDB key used to persist a block's collapsed state.
 * Encodes the kind so code / blockquote / quote-reply entries can't collide
 * within a single message, even if their hashes happened to coincide.
 */
export function composeBlockCollapseKey(messageId: string, kind: MarkdownBlockKind, contentHash: string): string {
  return `${messageId}:${kind}:${contentHash}`
}
