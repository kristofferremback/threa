import { createContext, useContext, type ReactNode } from "react"

/**
 * Scopes code blocks to a specific message id so each block's
 * user-toggled collapse state can be persisted per-message.
 *
 * We identify individual code blocks by a hash of their content + language
 * rather than positional index: the hash is stable across re-renders and
 * across Suspense boundaries, and avoids coupling state to the exact order
 * in which react-markdown walks the tree. Two identical blocks in a single
 * message sharing state is an acceptable edge case.
 */
interface CodeBlockMessageContextValue {
  messageId: string
}

const CodeBlockMessageContext = createContext<CodeBlockMessageContextValue | null>(null)

interface CodeBlockMessageProviderProps {
  messageId: string
  children: ReactNode
}

export function CodeBlockMessageProvider({ messageId, children }: CodeBlockMessageProviderProps) {
  return <CodeBlockMessageContext.Provider value={{ messageId }}>{children}</CodeBlockMessageContext.Provider>
}

export function useCodeBlockMessageContext(): CodeBlockMessageContextValue | null {
  return useContext(CodeBlockMessageContext)
}

/**
 * Fast deterministic hash of a string using the DJB2 algorithm.
 * Output is a base-36 unsigned 32-bit integer — short, URL-safe, and
 * stable across platforms. Not cryptographic; just enough to identify
 * code blocks within a single message.
 */
export function hashCodeBlock(content: string, language: string): string {
  const input = `${language}\u0000${content}`
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i)
    // Clamp to 32 bits so the shift doesn't produce floats.
    hash |= 0
  }
  return (hash >>> 0).toString(36)
}
