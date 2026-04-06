import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react"
import { db } from "@/db"
import { serializeToMarkdown } from "@threa/prosemirror"
import type { JSONContent } from "@threa/types"

type MessageStatus = "pending" | "failed" | "editing"

interface PendingMessagesContextValue {
  getStatus: (id: string) => MessageStatus | null
  markPending: (id: string) => void
  markFailed: (id: string) => void
  markSent: (id: string) => void
  /** Put a pending/failed message into editing mode so the queue skips it */
  markEditing: (id: string) => Promise<void>
  /** Save edits to an unsent message, return it to pending, and kick the queue */
  saveEditedMessage: (id: string, contentJson: JSONContent) => Promise<void>
  /** Cancel editing and return message to its previous queue state */
  cancelEditing: (id: string) => Promise<void>
  /** Reset a failed message's retry count and re-enqueue it for sending */
  retryMessage: (id: string) => Promise<void>
  /** Permanently delete a failed message from the outbox and timeline */
  deleteMessage: (id: string) => Promise<void>
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
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set())
  const queueNotifyRef = useRef<(() => void) | null>(null)

  // Hydrate pending/failed/editing state from IDB on mount so it survives page reload.
  // The _status field on CachedEvent is the durable source of truth.
  useEffect(() => {
    void (async () => {
      try {
        const pending = await db.events.where("_status").equals("pending").primaryKeys()
        const failed = await db.events.where("_status").equals("failed").primaryKeys()
        const editing = await db.events.where("_status").equals("editing").primaryKeys()
        if (pending.length > 0) setPendingIds(new Set(pending as string[]))
        if (failed.length > 0) setFailedIds(new Set(failed as string[]))
        if (editing.length > 0) setEditingIds(new Set(editing as string[]))
      } catch {
        // Best-effort — works in browser, may fail in test environment mocks
      }
    })()
  }, [])

  const getStatus = useCallback(
    (id: string): MessageStatus | null => {
      if (editingIds.has(id)) return "editing"
      if (pendingIds.has(id)) return "pending"
      if (failedIds.has(id)) return "failed"
      return null
    },
    [pendingIds, failedIds, editingIds]
  )

  const markPending = useCallback((id: string) => {
    setPendingIds((prev) => new Set(prev).add(id))
    setFailedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    setEditingIds((prev) => {
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
    setEditingIds((prev) => {
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
    setEditingIds((prev) => {
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

  const markEditing = useCallback(async (id: string) => {
    const existing = await db.pendingMessages.get(id)
    if (!existing) return

    type UpdateFn = (key: string, changes: Record<string, unknown>) => Promise<number>
    await (db.pendingMessages.update as unknown as UpdateFn)(id, { status: "editing" })
    await db.events.update(id, { _status: "editing" })

    setEditingIds((prev) => new Set(prev).add(id))
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

  const saveEditedMessage = useCallback(
    async (id: string, contentJson: JSONContent) => {
      const existing = await db.pendingMessages.get(id)
      if (!existing) return

      const contentMarkdown = serializeToMarkdown(contentJson).trim()

      // Update the pending message content in IDB
      type UpdateFn = (key: string, changes: Record<string, unknown>) => Promise<number>
      await (db.pendingMessages.update as unknown as UpdateFn)(id, {
        content: contentMarkdown,
        contentJson,
        status: undefined, // clear editing hold
        retryCount: 0,
        retryAfter: 0,
      })

      // Update the optimistic event's payload so the timeline reflects the edit
      const event = await db.events.get(id)
      if (event) {
        const payload = event.payload as Record<string, unknown>
        await db.events.put({
          ...event,
          payload: { ...payload, contentMarkdown, contentJson },
          _status: "pending",
        })
      }

      // Move to pending state and kick the queue
      setPendingIds((prev) => new Set(prev).add(id))
      setEditingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      notifyQueue()
    },
    [notifyQueue]
  )

  const cancelEditing = useCallback(async (id: string) => {
    const existing = await db.pendingMessages.get(id)
    if (!existing) return

    // Return to queued state — use pending (retry immediately) or failed based on retry count
    const wasFailed = existing.retryCount > 0
    type UpdateFn = (key: string, changes: Record<string, unknown>) => Promise<number>
    await (db.pendingMessages.update as unknown as UpdateFn)(id, { status: undefined })

    const newStatus = wasFailed ? "failed" : "pending"
    await db.events.update(id, { _status: newStatus })

    setEditingIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    if (wasFailed) {
      setFailedIds((prev) => new Set(prev).add(id))
    } else {
      setPendingIds((prev) => new Set(prev).add(id))
    }
  }, [])

  const retryMessage = useCallback(
    async (id: string) => {
      // Verify the message still exists — the user may have deleted it
      // while the retry button was visible. Without this guard, markPending
      // would lock the UI in "pending" with no queue record to resolve it.
      const existing = await db.pendingMessages.get(id)
      if (!existing) return

      // Reset retry count AND backoff so the queue picks it up immediately.
      // Dexie's deep KeyPaths inference hits a circular type on JSONContent.
      // Cast through unknown to bypass the broken type inference.
      type UpdateFn = (key: string, changes: Record<string, unknown>) => Promise<number>
      await (db.pendingMessages.update as unknown as UpdateFn)(id, { retryCount: 0, retryAfter: 0 })
      await db.events.update(id, { _status: "pending" })
      markPending(id)
      notifyQueue()
    },
    [markPending, notifyQueue]
  )

  const deleteMessage = useCallback(async (id: string) => {
    await db.pendingMessages.delete(id)
    await db.events.delete(id)
    // Clear from React state
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
    setEditingIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  return (
    <PendingMessagesContext.Provider
      value={{
        getStatus,
        markPending,
        markFailed,
        markSent,
        markEditing,
        saveEditedMessage,
        cancelEditing,
        retryMessage,
        deleteMessage,
        notifyQueue,
        registerQueueNotify,
      }}
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
