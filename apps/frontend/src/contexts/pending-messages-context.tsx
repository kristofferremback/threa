import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react"
import { db } from "@/db"

type MessageStatus = "pending" | "failed"

interface PendingMessagesContextValue {
  getStatus: (id: string) => MessageStatus | null
  markPending: (id: string) => void
  markFailed: (id: string) => void
  markSent: (id: string) => void
  /** Reset a failed message's retry count and re-enqueue it for sending */
  retryMessage: (id: string) => Promise<void>
  /** Kick the background message queue to process the next pending message */
  notifyQueue: () => void
  /** Register the queue's notify callback (called by useMessageQueue). Pass null to unregister. */
  registerQueueNotify: (fn: (() => void) | null) => void
}

const PendingMessagesContext = createContext<PendingMessagesContextValue | null>(null)

interface PendingMessagesProviderProps {
  children: ReactNode
}

export function PendingMessagesProvider({ children }: PendingMessagesProviderProps) {
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set())
  const queueNotifyRef = useRef<(() => void) | null>(null)

  const getStatus = useCallback(
    (id: string): MessageStatus | null => {
      if (pendingIds.has(id)) return "pending"
      if (failedIds.has(id)) return "failed"
      return null
    },
    [pendingIds, failedIds]
  )

  const markPending = useCallback((id: string) => {
    setPendingIds((prev) => new Set(prev).add(id))
    setFailedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const markFailed = useCallback((id: string) => {
    setFailedIds((prev) => new Set(prev).add(id))
    setPendingIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const markSent = useCallback((id: string) => {
    setPendingIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    setFailedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const notifyQueue = useCallback(() => {
    queueNotifyRef.current?.()
  }, [])

  const registerQueueNotify = useCallback((fn: (() => void) | null) => {
    if (process.env.NODE_ENV !== "production" && fn && queueNotifyRef.current) {
      console.warn("registerQueueNotify: overwriting an existing callback — only one queue processor should be mounted")
    }
    queueNotifyRef.current = fn
  }, [])

  const retryMessage = useCallback(
    async (id: string) => {
      // Verify the message still exists — it may have been deleted after
      // MAX_RETRY_COUNT exhaustion. Without this guard, markPending would
      // lock the UI in "pending" with no queue record to resolve it.
      const existing = await db.pendingMessages.get(id)
      if (!existing) return

      // Reset retry count so the queue processor will pick it up again
      // Dexie's deep KeyPaths inference hits a circular type on JSONContent.
      // Cast through unknown to bypass the broken type inference.
      type UpdateFn = (key: string, changes: Record<string, unknown>) => Promise<number>
      await (db.pendingMessages.update as unknown as UpdateFn)(id, { retryCount: 0 })
      await db.events.update(id, { _status: "pending" })
      markPending(id)
      notifyQueue()
    },
    [markPending, notifyQueue]
  )

  return (
    <PendingMessagesContext.Provider
      value={{ getStatus, markPending, markFailed, markSent, retryMessage, notifyQueue, registerQueueNotify }}
    >
      {children}
    </PendingMessagesContext.Provider>
  )
}

export function usePendingMessages(): PendingMessagesContextValue {
  const context = useContext(PendingMessagesContext)
  if (!context) {
    throw new Error("usePendingMessages must be used within a PendingMessagesProvider")
  }
  return context
}
