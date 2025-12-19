import { useEffect, useRef } from "react"
import { useSocket, usePendingMessages } from "@/contexts"
import { db } from "@/db"

const MAX_RETRY_COUNT = 3

/**
 * Hook that automatically retries pending messages when socket reconnects.
 *
 * Should be mounted once at app level. On socket connection, it checks for
 * pending messages in IndexedDB and retries them in order.
 */
export function usePendingMessageRetry(): void {
  const socket = useSocket()
  const { retryMessage, markFailed } = usePendingMessages()
  const isRetrying = useRef(false)

  useEffect(() => {
    if (!socket) return

    const handleConnect = async () => {
      // Prevent concurrent retry runs
      if (isRetrying.current) return
      isRetrying.current = true

      try {
        const pendingMessages = await db.pendingMessages.orderBy("createdAt").toArray()

        for (const pending of pendingMessages) {
          // Check if max retries reached
          if (pending.retryCount >= MAX_RETRY_COUNT) {
            markFailed(pending.clientId)
            continue
          }

          // Increment retry count before attempting
          await db.pendingMessages.update(pending.clientId, {
            retryCount: pending.retryCount + 1,
          })

          await retryMessage(pending.clientId)
        }
      } finally {
        isRetrying.current = false
      }
    }

    socket.on("connect", handleConnect)

    return () => {
      socket.off("connect", handleConnect)
    }
  }, [socket, retryMessage, markFailed])
}
