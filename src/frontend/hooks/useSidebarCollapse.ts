import { useState, useEffect, useCallback, useRef } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { settingsApi, type SidebarCollapseSettings } from "../../shared/api/settings-api"

export type CollapseState = "open" | "soft" | "hard"

export type SectionId = "pinned" | "channels" | "thinkingSpaces" | "directMessages"

type SidebarCollapseState = SidebarCollapseSettings

const STORAGE_KEY = "threa-sidebar-collapse"

const DEFAULT_STATE: SidebarCollapseState = {
  pinned: "open",
  channels: "open",
  thinkingSpaces: "open",
  directMessages: "open",
}

function loadFromStorage(): SidebarCollapseState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return { ...DEFAULT_STATE, ...parsed }
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_STATE
}

function saveToStorage(state: SidebarCollapseState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage errors
  }
}

interface UseSidebarCollapseOptions {
  workspaceId?: string
}

export function useSidebarCollapse(options: UseSidebarCollapseOptions = {}) {
  const { workspaceId } = options
  const queryClient = useQueryClient()
  const [state, setState] = useState<SidebarCollapseState>(loadFromStorage)
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasAppliedServerSettings = useRef(false)

  // Fetch settings from backend
  const { data: serverSettings } = useQuery({
    queryKey: ["settings", workspaceId],
    queryFn: async () => {
      if (!workspaceId) throw new Error("No workspace ID")
      return settingsApi.getSettings(workspaceId)
    },
    enabled: Boolean(workspaceId),
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  })

  // Mutation to sync settings to backend
  const syncMutation = useMutation({
    mutationFn: async (newState: SidebarCollapseState) => {
      if (!workspaceId) throw new Error("No workspace ID")
      return settingsApi.updateSettings(workspaceId, { sidebarCollapse: newState })
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["settings", workspaceId], data)
    },
  })

  // Apply server settings when they arrive (only once per session)
  useEffect(() => {
    if (serverSettings?.settings?.sidebarCollapse && !hasAppliedServerSettings.current) {
      const serverCollapse = serverSettings.settings.sidebarCollapse
      const merged = { ...DEFAULT_STATE, ...serverCollapse }
      setState(merged)
      saveToStorage(merged)
      hasAppliedServerSettings.current = true
    }
  }, [serverSettings])

  // Save to localStorage immediately on state change
  useEffect(() => {
    saveToStorage(state)
  }, [state])

  // Debounced sync to backend
  const syncToBackend = useCallback(
    (newState: SidebarCollapseState) => {
      if (!workspaceId) return

      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }

      syncTimeoutRef.current = setTimeout(() => {
        syncMutation.mutate(newState)
      }, 500)
    },
    [workspaceId, syncMutation],
  )

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }
    }
  }, [])

  const getState = useCallback(
    (section: SectionId): CollapseState => {
      return state[section]
    },
    [state],
  )

  /**
   * Toggle collapse state on left click:
   * - open → soft (show only items with activity)
   * - soft → open
   * - hard → open
   */
  const toggle = useCallback(
    (section: SectionId) => {
      setState((prev) => {
        const current = prev[section]
        const next = current === "open" ? "soft" : "open"
        const newState = { ...prev, [section]: next }
        syncToBackend(newState)
        return newState
      })
    },
    [syncToBackend],
  )

  /**
   * Hard collapse on right click (context menu):
   * - open → hard
   * - soft → hard
   * - hard → open
   */
  const toggleHard = useCallback(
    (section: SectionId) => {
      setState((prev) => {
        const current = prev[section]
        const next = current === "hard" ? "open" : "hard"
        const newState = { ...prev, [section]: next }
        syncToBackend(newState)
        return newState
      })
    },
    [syncToBackend],
  )

  /**
   * Set a specific state directly
   */
  const setCollapseState = useCallback(
    (section: SectionId, newCollapseState: CollapseState) => {
      setState((prev) => {
        const newState = { ...prev, [section]: newCollapseState }
        syncToBackend(newState)
        return newState
      })
    },
    [syncToBackend],
  )

  return {
    state,
    getState,
    toggle,
    toggleHard,
    setCollapseState,
  }
}
