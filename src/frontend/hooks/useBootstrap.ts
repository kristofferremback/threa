import { useState, useEffect, useCallback } from "react"
import type { BootstrapData, Channel } from "../types"

interface UseBootstrapOptions {
  enabled?: boolean
}

interface UseBootstrapReturn {
  data: BootstrapData | null
  isLoading: boolean
  error: string | null
  noWorkspace: boolean
  refetch: () => void
  addChannel: (channel: Channel) => void
  updateChannel: (channel: Channel) => void
  removeChannel: (channelId: string) => void
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

  // Add a channel to the local state (after creation)
  const addChannel = useCallback((channel: Channel) => {
    setData((prev) => {
      if (!prev) return prev
      // Insert in alphabetical order
      const channels = [...prev.channels, channel].sort((a, b) => a.name.localeCompare(b.name))
      return { ...prev, channels }
    })
  }, [])

  // Update a channel in the local state
  const updateChannel = useCallback((channel: Channel) => {
    setData((prev) => {
      if (!prev) return prev
      const channels = prev.channels
        .map((c) => (c.id === channel.id ? { ...c, ...channel } : c))
        .sort((a, b) => a.name.localeCompare(b.name))
      return { ...prev, channels }
    })
  }, [])

  // Remove a channel from the local state (after archiving)
  const removeChannel = useCallback((channelId: string) => {
    setData((prev) => {
      if (!prev) return prev
      const channels = prev.channels.filter((c) => c.id !== channelId)
      return { ...prev, channels }
    })
  }, [])

  return {
    data,
    isLoading,
    error,
    noWorkspace,
    refetch: fetchBootstrap,
    addChannel,
    updateChannel,
    removeChannel,
  }
}
