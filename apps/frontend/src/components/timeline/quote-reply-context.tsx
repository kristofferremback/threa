import { createContext, useContext, useCallback, useRef } from "react"
import type { ReactNode } from "react"

export interface QuoteReplyData {
  messageId: string
  streamId: string
  authorName: string
  /** Markdown content to quote (preserves formatting) */
  snippet: string
}

interface QuoteReplyContextValue {
  /** Trigger a quote reply — called by message actions */
  triggerQuoteReply: (data: QuoteReplyData) => void
  /** Register the composer's insertion handler */
  registerHandler: (handler: (data: QuoteReplyData) => void) => () => void
}

const QuoteReplyCtx = createContext<QuoteReplyContextValue | null>(null)

export function QuoteReplyProvider({ children }: { children: ReactNode }) {
  const handlerRef = useRef<((data: QuoteReplyData) => void) | null>(null)

  const registerHandler = useCallback((handler: (data: QuoteReplyData) => void) => {
    handlerRef.current = handler
    return () => {
      handlerRef.current = null
    }
  }, [])

  const triggerQuoteReply = useCallback((data: QuoteReplyData) => {
    handlerRef.current?.(data)
  }, [])

  return <QuoteReplyCtx.Provider value={{ triggerQuoteReply, registerHandler }}>{children}</QuoteReplyCtx.Provider>
}

export function useQuoteReply(): QuoteReplyContextValue | null {
  return useContext(QuoteReplyCtx)
}
