import { useEffect, useRef, useCallback } from "react"
import { useSocketConnected, useMessageService, usePendingMessages } from "@/contexts"
import { db } from "@/db"
import { parseMarkdown } from "@threa/prosemirror"

/**
 * Exponential backoff delay based on retry count.
 * First 3 retries are immediate (within the same drain cycle, skipped to next cycle).
 * After that, delays increase to prevent hammering a down server.
 */
function getRetryDelay(retryCount: number): number {
  if (retryCount <= 3) return 0
  if (retryCount <= 6) return 5_000
  if (retryCount <= 10) return 30_000
  return 120_000 // 2 min cap
}

/**
 * Background queue processor that drains pending messages from IndexedDB.
 *
 * Messages are sent in createdAt order, one at a time. The queue is triggered
 * whenever a new message is enqueued (via context `notifyQueue()`) or the
 * socket reconnects.
 *
 * Key invariants:
 * - Messages are NEVER deleted from the queue on failure. They stay until
 *   confirmed by the server or manually deleted by the user.
 * - Offline detection prevents retries from consuming backoff slots — only
 *   genuine send failures (while connected) increment retryCount.
 * - Exponential backoff via `retryAfter` prevents hammering after failures.
 * - Web Locks API prevents multiple tabs from processing the same message.
 * - Failed messages are skipped so newer messages aren't blocked.
 */
export function useMessageQueue(): void {
  const isConnected = useSocketConnected()
  const messageService = useMessageService()
  const { markPending, markFailed, markSent, registerQueueNotify } = usePendingMessages()

  const isProcessing = useRef(false)
  const hasPendingWork = useRef(false)
  const isConnectedRef = useRef(isConnected)
  isConnectedRef.current = isConnected

  const drainQueue = useCallback(async () => {
    const now = Date.now()
    // Track messages that failed in this drain cycle so we skip past them
    // and deliver newer messages instead of blocking at the head of the queue.
    const skippedIds = new Set<string>()

    while (true) {
      if (!isConnectedRef.current) break

      const candidates = await db.pendingMessages.orderBy("createdAt").toArray()
      const next = candidates.find((m) => !skippedIds.has(m.clientId) && (m.retryAfter ?? 0) <= now)
      if (!next) break

      markPending(next.clientId)
      await db.events.update(next.clientId, { _status: "pending" })

      try {
        const contentJson = next.contentJson ?? parseMarkdown(next.content)

        await messageService.create(next.workspaceId, next.streamId, {
          streamId: next.streamId,
          contentJson,
          contentMarkdown: next.content,
          attachmentIds: next.attachmentIds,
          clientMessageId: next.clientId,
        })

        await db.pendingMessages.delete(next.clientId)

        // Do NOT delete the optimistic event from db.events here.
        // The socket handler (handleMessageCreated in stream-sync.ts) atomically
        // swaps the optimistic event for the real server event in a single
        // Dexie transaction.
        markSent(next.clientId)
      } catch {
        // Increment retry count and set backoff delay.
        // Only genuine send failures (while connected) reach here —
        // the offline check at the top of the loop prevents transient
        // connectivity issues from consuming backoff slots.
        const retryCount = next.retryCount + 1
        const delay = getRetryDelay(retryCount)
        // Dexie's deep KeyPaths inference hits a circular type on JSONContent.
        type UpdateFn = (key: string, changes: Record<string, unknown>) => Promise<number>
        await (db.pendingMessages.update as unknown as UpdateFn)(next.clientId, {
          retryCount,
          retryAfter: Date.now() + delay,
        })
        await db.events.update(next.clientId, { _status: "failed" })
        markFailed(next.clientId)
        // Skip this message for the rest of this drain cycle so newer
        // messages are not blocked behind it.
        skippedIds.add(next.clientId)
      }
    }
  }, [messageService, markPending, markFailed, markSent])

  const processQueue = useCallback(async () => {
    if (isProcessing.current) {
      hasPendingWork.current = true
      return
    }

    isProcessing.current = true
    hasPendingWork.current = false

    try {
      // Cross-tab safety: only one tab processes the outbox at a time.
      // If another tab holds the lock, we skip — it's already processing.
      if (navigator.locks) {
        await navigator.locks.request("threa-outbox", { ifAvailable: true }, async (lock) => {
          if (!lock) return // Another tab is processing
          await drainQueue()
        })
      } else {
        // Fallback for browsers without Web Locks API
        await drainQueue()
      }
    } finally {
      isProcessing.current = false

      if (hasPendingWork.current) {
        hasPendingWork.current = false
        void processQueue()
      }
    }
  }, [drainQueue])

  // Register notify callback so other hooks can kick the queue via context
  useEffect(() => {
    registerQueueNotify(() => void processQueue())
    return () => registerQueueNotify(null)
  }, [registerQueueNotify, processQueue])

  // Drain queue when socket (re)connects
  useEffect(() => {
    if (isConnected) {
      void processQueue()
    }
  }, [isConnected, processQueue])
}
