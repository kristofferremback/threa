import { useEffect, useRef, useCallback } from "react"
import { useSocketConnected, useMessageService, usePendingMessages } from "@/contexts"
import { db } from "@/db"
import { parseMarkdown } from "@threa/prosemirror"

const MAX_RETRY_COUNT = 3

/**
 * Background queue processor that drains pending messages from IndexedDB.
 *
 * Messages are sent in createdAt order, one at a time. The queue is triggered
 * whenever a new message is enqueued (via context `notifyQueue()`) or the
 * socket reconnects. The loop short-circuits when offline so that connectivity
 * failures never increment retryCount — only genuine send failures (while
 * connected) consume retry slots.
 *
 * When a message fails, the loop continues to deliver newer messages rather
 * than blocking at the head of the queue. Failed messages are retried on the
 * next drain cycle (reconnect or new enqueue).
 */
export function useMessageQueue(): void {
  const isConnected = useSocketConnected()
  const messageService = useMessageService()
  const { markPending, markFailed, markSent, registerQueueNotify } = usePendingMessages()

  const isProcessing = useRef(false)
  const hasPendingWork = useRef(false)
  const isConnectedRef = useRef(isConnected)
  isConnectedRef.current = isConnected

  const processQueue = useCallback(async () => {
    if (isProcessing.current) {
      hasPendingWork.current = true
      return
    }

    isProcessing.current = true
    hasPendingWork.current = false

    try {
      // Track messages that failed in this drain cycle so we skip past them
      // and deliver newer messages instead of blocking at the head of the queue.
      const skippedIds = new Set<string>()

      while (true) {
        if (!isConnectedRef.current) break

        const candidates = await db.pendingMessages.orderBy("createdAt").toArray()
        const next = candidates.find((m) => !skippedIds.has(m.clientId))
        if (!next) break

        if (next.retryCount >= MAX_RETRY_COUNT) {
          markFailed(next.clientId)
          await db.events.update(next.clientId, { _status: "failed" })
          await db.pendingMessages.delete(next.clientId)
          continue
        }

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
          await db.events.delete(next.clientId)

          // Don't remove the optimistic event from the React Query cache here.
          // The socket handler (handleMessageCreated) atomically swaps the
          // optimistic event for the real server event in a single setQueryData
          // call, preventing the message from flickering out of view between
          // the HTTP response and the socket broadcast.
          markSent(next.clientId)
        } catch {
          // Increment retry count only after a confirmed failure, so transient
          // connectivity issues don't silently exhaust retries.
          // Dexie's deep KeyPaths inference hits a circular type on JSONContent.
          type UpdateFn = (key: string, changes: Record<string, unknown>) => Promise<number>
          await (db.pendingMessages.update as unknown as UpdateFn)(next.clientId, {
            retryCount: next.retryCount + 1,
          })
          await db.events.update(next.clientId, { _status: "failed" })
          markFailed(next.clientId)
          // Skip this message for the rest of this drain cycle so newer
          // messages are not blocked behind it.
          skippedIds.add(next.clientId)
        }
      }
    } finally {
      isProcessing.current = false

      if (hasPendingWork.current) {
        hasPendingWork.current = false
        void processQueue()
      }
    }
  }, [messageService, markPending, markFailed, markSent])

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
