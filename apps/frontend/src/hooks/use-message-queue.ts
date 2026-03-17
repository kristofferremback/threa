import { useEffect, useRef, useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useSocketConnected, useMessageService, usePendingMessages } from "@/contexts"
import { db } from "@/db"
import { streamKeys } from "./use-streams"
import { parseMarkdown } from "@threa/prosemirror"
import type { StreamEvent } from "@threa/types"

const MAX_RETRY_COUNT = 3

/**
 * Background queue processor that drains pending messages from IndexedDB.
 *
 * Messages are sent in createdAt order, one at a time. The queue is triggered
 * whenever a new message is enqueued (via context `notifyQueue()`) or the
 * socket reconnects. The loop short-circuits when offline so that connectivity
 * failures never increment retryCount — only genuine send failures (while
 * connected) consume retry slots.
 */
export function useMessageQueue(): void {
  const isConnected = useSocketConnected()
  const messageService = useMessageService()
  const { markPending, markFailed, markSent, registerQueueNotify } = usePendingMessages()
  const queryClient = useQueryClient()

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
      while (true) {
        if (!isConnectedRef.current) break

        const next = await db.pendingMessages.orderBy("createdAt").first()
        if (!next) break

        if (next.retryCount >= MAX_RETRY_COUNT) {
          markFailed(next.clientId)
          await db.events.update(next.clientId, { _status: "failed" })
          await db.pendingMessages.delete(next.clientId)
          continue
        }

        markPending(next.clientId)

        try {
          const contentJson = next.contentJson ?? parseMarkdown(next.content)

          await messageService.create(next.workspaceId, next.streamId, {
            streamId: next.streamId,
            contentJson,
            contentMarkdown: next.content,
            attachmentIds: next.attachmentIds,
          })

          await db.pendingMessages.delete(next.clientId)
          await db.events.delete(next.clientId)

          queryClient.setQueryData(streamKeys.bootstrap(next.workspaceId, next.streamId), (old: unknown) => {
            if (!old || typeof old !== "object") return old
            const bootstrap = old as { events: StreamEvent[] }
            return {
              ...bootstrap,
              events: bootstrap.events.filter((e) => e.id !== next.clientId),
            }
          })

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
          break
        }
      }
    } finally {
      isProcessing.current = false

      if (hasPendingWork.current) {
        hasPendingWork.current = false
        void processQueue()
      }
    }
  }, [messageService, queryClient, markPending, markFailed, markSent])

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
