import { useState, useEffect, useCallback } from "react"
import type { BootstrapData, Stream } from "../types"

interface UseBootstrapOptions {
  enabled?: boolean
}

interface UseBootstrapReturn {
  data: BootstrapData | null
  isLoading: boolean
  error: string | null
  noWorkspace: boolean
  refetch: () => void
  addStream: (stream: Stream) => void
  updateStream: (stream: Stream) => void
  removeStream: (streamId: string) => void
  incrementUnreadCount: (streamId: string, increment?: number) => void
  resetUnreadCount: (streamId: string) => void
}

export function useBootstrap({ enabled = true }: UseBootstrapOptions = {}): UseBootstrapReturn {
  const [data, setData] = useState<BootstrapData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noWorkspace, setNoWorkspace] = useState(false)

  const fetchBootstrap = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      // First, get user's workspaces
      const meRes = await fetch("/api/auth/me", { credentials: "include" })
      if (!meRes.ok) throw new Error("Failed to fetch user")

      // For now, get first workspace from workspace_members
      const wsRes = await fetch("/api/workspace/default/bootstrap", { credentials: "include" })

      if (wsRes.status === 404 || wsRes.status === 403) {
        setNoWorkspace(true)
        setIsLoading(false)
        return
      }

      if (!wsRes.ok) {
        throw new Error("Failed to fetch workspace data")
      }

      const bootstrapData = (await wsRes.json()) as BootstrapData
      setData(bootstrapData)
      setNoWorkspace(false)
    } catch (err) {
      console.error("Bootstrap error:", err)
      setError(err instanceof Error ? err.message : "Failed to load workspace")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (enabled) {
      fetchBootstrap()
    }
  }, [enabled, fetchBootstrap])

  // Add a stream to the local state (after creation)
  const addStream = useCallback((stream: Stream) => {
    setData((prev) => {
      if (!prev) return prev
      // Check if stream already exists - if so, update instead of adding
      const existingIndex = prev.streams.findIndex((s) => s.id === stream.id)
      if (existingIndex >= 0) {
        // Stream already exists, update it
        const streams = prev.streams
          .map((s) => (s.id === stream.id ? { ...s, ...stream } : s))
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
        return { ...prev, streams }
      }
      // Insert in alphabetical order
      const streams = [...prev.streams, stream].sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      return { ...prev, streams }
    })
  }, [])

  // Update a stream in the local state
  const updateStream = useCallback((stream: Stream) => {
    setData((prev) => {
      if (!prev) return prev
      const streams = prev.streams
        .map((s) => (s.id === stream.id ? { ...s, ...stream } : s))
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      return { ...prev, streams }
    })
  }, [])

  // Remove a stream from the local state (after archiving)
  const removeStream = useCallback((streamId: string) => {
    setData((prev) => {
      if (!prev) return prev
      const streams = prev.streams.filter((s) => s.id !== streamId)
      return { ...prev, streams }
    })
  }, [])

  // Increment unread count for a stream
  const incrementUnreadCount = useCallback((streamId: string, increment: number = 1) => {
    setData((prev) => {
      if (!prev) return prev
      const streams = prev.streams.map((s) =>
        s.id === streamId || s.slug === streamId ? { ...s, unreadCount: s.unreadCount + increment } : s,
      )
      return { ...prev, streams }
    })
  }, [])

  // Reset unread count for a stream (when user views it)
  const resetUnreadCount = useCallback((streamId: string) => {
    setData((prev) => {
      if (!prev) return prev
      const streams = prev.streams.map((s) =>
        s.id === streamId || s.slug === streamId ? { ...s, unreadCount: 0 } : s,
      )
      return { ...prev, streams }
    })
  }, [])

  return {
    data,
    isLoading,
    error,
    noWorkspace,
    refetch: fetchBootstrap,
    addStream,
    updateStream,
    removeStream,
    incrementUnreadCount,
    resetUnreadCount,
  }
}
