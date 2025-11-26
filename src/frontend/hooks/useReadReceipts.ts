import { useRef, useCallback, useEffect } from "react"

interface UseReadReceiptsOptions {
  workspaceId: string
  channelId?: string
  conversationId?: string
  enabled?: boolean
}

interface PendingRead {
  messageId: string
  timestamp: number
}

export function useReadReceipts({ workspaceId, channelId, conversationId, enabled = true }: UseReadReceiptsOptions) {
  // Track messages that have been visible for 500ms+
  const visibleMessagesRef = useRef<Map<string, number>>(new Map())
  // Track the most recent message ID that should be marked as read
  const pendingReadRef = useRef<PendingRead | null>(null)
  // Debounce timer
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Max wait timer (2s upper limit)
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Last sent timestamp to prevent duplicate sends
  const lastSentRef = useRef<number>(0)

  const sendReadReceipt = useCallback(async () => {
    if (!pendingReadRef.current || !enabled) return

    const { messageId, timestamp } = pendingReadRef.current

    // Don't send if we just sent recently
    if (timestamp <= lastSentRef.current) return

    lastSentRef.current = timestamp
    pendingReadRef.current = null

    // Clear timers
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    if (maxWaitTimerRef.current) {
      clearTimeout(maxWaitTimerRef.current)
      maxWaitTimerRef.current = null
    }

    try {
      const endpoint = conversationId
        ? `/api/workspace/${workspaceId}/conversations/${conversationId}/read`
        : `/api/workspace/${workspaceId}/channels/${channelId}/read`

      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ messageId }),
      })
    } catch (error) {
      console.error("Failed to send read receipt:", error)
    }
  }, [workspaceId, channelId, conversationId, enabled])

  const scheduleReadReceipt = useCallback(
    (messageId: string) => {
      if (!enabled) return

      const now = Date.now()
      pendingReadRef.current = { messageId, timestamp: now }

      // Clear existing debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      // Set new debounce timer (500ms minimum wait)
      debounceTimerRef.current = setTimeout(() => {
        sendReadReceipt()
      }, 500)

      // Set max wait timer if not already set (2s upper limit)
      if (!maxWaitTimerRef.current) {
        maxWaitTimerRef.current = setTimeout(() => {
          maxWaitTimerRef.current = null
          sendReadReceipt()
        }, 2000)
      }
    },
    [enabled, sendReadReceipt],
  )

  // Track when a message becomes visible
  const onMessageVisible = useCallback(
    (messageId: string) => {
      if (!enabled) return

      const now = Date.now()
      visibleMessagesRef.current.set(messageId, now)

      // After 500ms, check if still visible and schedule read receipt
      setTimeout(() => {
        const entryTime = visibleMessagesRef.current.get(messageId)
        if (entryTime && now === entryTime) {
          // Message was visible for 500ms
          scheduleReadReceipt(messageId)
        }
      }, 500)
    },
    [enabled, scheduleReadReceipt],
  )

  // Track when a message becomes hidden
  const onMessageHidden = useCallback((messageId: string) => {
    visibleMessagesRef.current.delete(messageId)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      if (maxWaitTimerRef.current) {
        clearTimeout(maxWaitTimerRef.current)
      }
    }
  }, [])

  // Send any pending read receipt when channel/conversation changes
  useEffect(() => {
    return () => {
      // Flush pending read receipt when context changes
      if (pendingReadRef.current) {
        sendReadReceipt()
      }
    }
  }, [channelId, conversationId, sendReadReceipt])

  // Manual mark as read
  const markAsRead = useCallback(
    async (messageId: string) => {
      if (!enabled) return

      try {
        const endpoint = conversationId
          ? `/api/workspace/${workspaceId}/conversations/${conversationId}/read`
          : `/api/workspace/${workspaceId}/channels/${channelId}/read`

        await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ messageId }),
        })
      } catch (error) {
        console.error("Failed to mark as read:", error)
      }
    },
    [workspaceId, channelId, conversationId, enabled],
  )

  // Manual mark as unread
  const markAsUnread = useCallback(
    async (messageId: string) => {
      if (!enabled) return

      try {
        const endpoint = conversationId
          ? `/api/workspace/${workspaceId}/conversations/${conversationId}/unread`
          : `/api/workspace/${workspaceId}/channels/${channelId}/unread`

        await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ messageId }),
        })
      } catch (error) {
        console.error("Failed to mark as unread:", error)
      }
    },
    [workspaceId, channelId, conversationId, enabled],
  )

  return {
    onMessageVisible,
    onMessageHidden,
    markAsRead,
    markAsUnread,
  }
}

// Hook for individual message visibility tracking
export function useMessageVisibility(
  messageId: string,
  onVisible: (id: string) => void,
  onHidden: (id: string) => void,
) {
  const elementRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    const element = elementRef.current
    if (!element) return

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            onVisible(messageId)
          } else {
            onHidden(messageId)
          }
        })
      },
      {
        threshold: 0.5, // 50% of the message must be visible
        rootMargin: "0px",
      },
    )

    observerRef.current.observe(element)

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
      onHidden(messageId)
    }
  }, [messageId, onVisible, onHidden])

  return elementRef
}
