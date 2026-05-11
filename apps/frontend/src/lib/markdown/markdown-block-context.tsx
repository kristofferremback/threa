import { createContext, useContext, type ReactNode } from "react"

export type MarkdownBlockKind = "code" | "blockquote" | "quote-reply"

/**
 * Scopes collapsible markdown blocks to the surrounding message so per-block
 * toggle state can be persisted per-message. Blocks are identified by a
 * content hash (not positional index) so state stays stable across re-renders
 * and Suspense boundaries.
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
 * Marks descendants as rendered inside a foldable block so nested foldable
 * blocks (blockquote-in-blockquote, code-in-blockquote, quote-reply-in-quote)
 * skip their own collapse chrome. Only the outermost block folds; inner blocks
 * render plain. See `useBlockCollapse`.
 */
const InsideCollapsibleBlockContext = createContext<boolean>(false)

interface InsideCollapsibleBlockProviderProps {
  children: ReactNode
}

export function InsideCollapsibleBlockProvider({ children }: InsideCollapsibleBlockProviderProps) {
  return <InsideCollapsibleBlockContext.Provider value={true}>{children}</InsideCollapsibleBlockContext.Provider>
}

export function useIsInsideCollapsibleBlock(): boolean {
  return useContext(InsideCollapsibleBlockContext)
}

/**
 * DJB2 hash of `namespace\0content`. Namespacing keeps the hash spaces of
 * different block kinds (and of different code-block languages) disjoint so
 * identical content doesn't alias across them. Not cryptographic.
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

export function composeBlockCollapseKey(messageId: string, kind: MarkdownBlockKind, contentHash: string): string {
  return `${messageId}:${kind}:${contentHash}`
}
