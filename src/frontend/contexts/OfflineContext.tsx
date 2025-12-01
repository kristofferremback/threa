/**
 * Offline Context
 *
 * Provides offline state and actions to the entire app.
 * Handles connectivity tracking, outbox management, and cache operations.
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import {
  type ConnectionState,
  subscribeToConnectivity,
  isOnline as checkIsOnline,
  checkConnectivity,
} from "../lib/connectivity"
import { getPendingCount, processOutbox, clearOutbox, isIndexedDBAvailable, deleteDB, pruneCache } from "../lib/offline"

interface OfflineContextValue {
  // Connection state
  isOnline: boolean
  connectionState: ConnectionState

  // Outbox state
  pendingMessageCount: number
  isProcessingOutbox: boolean

  // Actions
  retryPending: () => Promise<void>
  clearPending: () => Promise<void>
  refreshPendingCount: () => Promise<void>

  // IndexedDB availability
  isOfflineSupported: boolean

  // Cleanup (for logout)
  clearAllOfflineData: () => Promise<void>
}

const OfflineContext = createContext<OfflineContextValue | null>(null)

interface OfflineProviderProps {
  children: ReactNode
  // Function to send a message (provided by parent)
  sendMessage?: (message: {
    workspaceId: string
    streamId: string
    content: string
    mentions: Array<{ type: string; id: string; label: string; slug?: string }>
    parentEventId?: string
    parentStreamId?: string
  }) => Promise<{ success: boolean; eventId?: string; error?: string }>
}

export function OfflineProvider({ children, sendMessage }: OfflineProviderProps) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("online")
  const [pendingMessageCount, setPendingMessageCount] = useState(0)
  const [isProcessingOutbox, setIsProcessingOutbox] = useState(false)
  const isOfflineSupported = isIndexedDBAvailable()

  // Subscribe to connectivity changes
  useEffect(() => {
    const unsubscribe = subscribeToConnectivity((state) => {
      setConnectionState(state)
    })

    return unsubscribe
  }, [])

  // Update pending count on mount and when online
  const refreshPendingCount = useCallback(async () => {
    if (!isOfflineSupported) return
    const count = await getPendingCount()
    setPendingMessageCount(count)
  }, [isOfflineSupported])

  useEffect(() => {
    refreshPendingCount()
  }, [refreshPendingCount])

  // Auto-process outbox when coming online
  useEffect(() => {
    if (connectionState === "online" && pendingMessageCount > 0 && sendMessage && !isProcessingOutbox) {
      // Small delay to ensure connection is stable
      const timer = setTimeout(() => {
        retryPending()
      }, 1000)

      return () => clearTimeout(timer)
    }
  }, [connectionState, pendingMessageCount])

  // Retry pending messages
  const retryPending = useCallback(async () => {
    if (!sendMessage || !isOfflineSupported || isProcessingOutbox) return
    if (!checkIsOnline()) return

    setIsProcessingOutbox(true)

    try {
      const result = await processOutbox(async (message) => {
        try {
          const response = await sendMessage({
            workspaceId: message.workspaceId,
            streamId: message.streamId,
            content: message.content,
            mentions: message.mentions,
            parentEventId: message.parentEventId,
            parentStreamId: message.parentStreamId,
          })
          return response
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          }
        }
      })

      console.log(
        `[Offline] Processed outbox: ${result.sent} sent, ${result.failed} failed, ${result.remaining} remaining`,
      )
    } finally {
      setIsProcessingOutbox(false)
      await refreshPendingCount()
    }
  }, [sendMessage, isOfflineSupported, isProcessingOutbox, refreshPendingCount])

  // Clear pending messages
  const clearPending = useCallback(async () => {
    if (!isOfflineSupported) return
    await clearOutbox()
    setPendingMessageCount(0)
  }, [isOfflineSupported])

  // Clear all offline data (for logout)
  const clearAllOfflineData = useCallback(async () => {
    if (!isOfflineSupported) return
    await deleteDB()
    setPendingMessageCount(0)
  }, [isOfflineSupported])

  // Prune cache on mount (cleanup old data)
  useEffect(() => {
    if (isOfflineSupported) {
      pruneCache().then((result) => {
        if (result.eventsDeleted > 0 || result.streamsDeleted > 0) {
          console.log(`[Offline] Pruned cache: ${result.eventsDeleted} events, ${result.streamsDeleted} streams`)
        }
      })
    }
  }, [isOfflineSupported])

  const value: OfflineContextValue = {
    isOnline: connectionState === "online",
    connectionState,
    pendingMessageCount,
    isProcessingOutbox,
    retryPending,
    clearPending,
    refreshPendingCount,
    isOfflineSupported,
    clearAllOfflineData,
  }

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
}

export function useOffline(): OfflineContextValue {
  const context = useContext(OfflineContext)
  if (!context) {
    // Return a default value if not wrapped in provider (graceful degradation)
    return {
      isOnline: true,
      connectionState: "online",
      pendingMessageCount: 0,
      isProcessingOutbox: false,
      retryPending: async () => {},
      clearPending: async () => {},
      refreshPendingCount: async () => {},
      isOfflineSupported: false,
      clearAllOfflineData: async () => {},
    }
  }
  return context
}

// Hook to check connectivity
export function useConnectivity(): {
  isOnline: boolean
  connectionState: ConnectionState
  checkNow: () => Promise<boolean>
} {
  const { isOnline, connectionState } = useOffline()

  return {
    isOnline,
    connectionState,
    checkNow: checkConnectivity,
  }
}
