import { createContext, useContext, useState, useCallback, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { db } from "@/db"
import { useMessageService } from "./services-context"
import { streamKeys } from "@/hooks/use-streams"

type MessageStatus = "pending" | "failed"

interface PendingMessagesContextValue {
  getStatus: (id: string) => MessageStatus | null
  markPending: (id: string) => void
  markFailed: (id: string) => void
  markSent: (id: string) => void
  retryMessage: (id: string) => Promise<void>
}

const PendingMessagesContext = createContext<PendingMessagesContextValue | null>(null)

interface PendingMessagesProviderProps {
  children: ReactNode
}

export function PendingMessagesProvider({ children }: PendingMessagesProviderProps) {
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set())
  const messageService = useMessageService()
  const queryClient = useQueryClient()

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

  const retryMessage = useCallback(
    async (id: string) => {
      const pending = await db.pendingMessages.get(id)
      if (!pending) {
        console.warn(`No pending message found for id: ${id}`)
        return
      }

      markPending(id)

      try {
        await messageService.create(pending.workspaceId, pending.streamId, {
          streamId: pending.streamId,
          content: pending.content,
          contentFormat: pending.contentFormat,
        })

        // Clean up on success
        await db.pendingMessages.delete(id)
        await db.events.delete(id)

        // Remove optimistic event from cache - real event arrives via WebSocket
        queryClient.setQueryData(streamKeys.bootstrap(pending.workspaceId, pending.streamId), (old: unknown) => {
          if (!old || typeof old !== "object") return old
          const bootstrap = old as { events: Array<{ id: string }> }
          return {
            ...bootstrap,
            events: bootstrap.events.filter((e) => e.id !== id),
          }
        })

        markSent(id)
      } catch {
        markFailed(id)
      }
    },
    [messageService, queryClient, markPending, markFailed, markSent]
  )

  return (
    <PendingMessagesContext.Provider value={{ getStatus, markPending, markFailed, markSent, retryMessage }}>
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
