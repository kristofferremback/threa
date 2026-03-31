import { createContext, useContext, useState, useEffect, useMemo, useRef, type ReactNode } from "react"
import { usePreloadImages } from "@/hooks/use-preload-images"
import { useCoordinatedStreamQueries } from "@/hooks/use-coordinated-stream-queries"
import {
  hasSeededWorkspaceCache,
  seedCacheFromIdb,
  useWorkspaceBots,
  useWorkspaceDmPeers,
  useWorkspaceFromStore,
  useWorkspaceMetadata,
  useWorkspacePersonas,
  useWorkspaceStreamMemberships,
  useWorkspaceStreams,
  useWorkspaceUnreadState,
  useWorkspaceUsers,
} from "@/stores/workspace-store"
import { getCachedStreamEvents, hasCachedMessageAtOrAfter, hasStreamEventCache } from "@/stores/stream-store"
import { hasSeededDraftCache, seedDraftCacheFromIdb } from "@/stores/draft-store"
import { useSyncStatus } from "@/sync/sync-status"
import { debugBootstrap } from "@/lib/bootstrap-debug"
import { getQueryLoadState, isQueryLoadStateLoading, shouldSuppressBootstrapError } from "@/lib/query-load-state"
import { StreamContentSkeleton } from "@/components/loading"
import { ApiError } from "@/api/client"
import { getAvatarUrl } from "@threa/types"

/**
 * Global coordinated loading phase - only applies during initial app load.
 * - "loading": First ~300ms of initial load, UI shows blank
 * - "skeleton": After ~300ms, UI shows skeleton placeholders
 * - "ready": Initial load complete, never returns to loading/skeleton
 */
export type CoordinatedPhase = "loading" | "skeleton" | "ready"

/**
 * Per-stream loading state - only reports loading AFTER initial load completes.
 * During initial load, all streams report "idle" (the global phase handles that).
 */
export type StreamState = "idle" | "loading" | "error"

interface StreamError {
  streamId: string
  status: number
  error: Error
}

interface CoordinatedLoadingContextValue {
  /** Global coordinated loading phase */
  phase: CoordinatedPhase

  /** True if any stream has an error (used by MainContentGate to show error pages) */
  hasErrors: boolean

  /** Get state for a specific stream. Returns "idle" during initial load. */
  getStreamState: (streamId: string) => StreamState

  /** Get error details for a stream in error state */
  getStreamError: (streamId: string) => StreamError | undefined

  /** True when any loading is happening (for topbar loading indicator) */
  isLoading: boolean

  /** True when loading indicator should be visible (after delay, same as skeleton) */
  showLoadingIndicator: boolean
}

const CoordinatedLoadingContext = createContext<CoordinatedLoadingContextValue | null>(null)

interface CoordinatedLoadingProviderProps {
  workspaceId: string
  streamIds: string[]
  children: ReactNode
}

const LOADING_DELAY_MS = 300

export function CoordinatedLoadingProvider({ workspaceId, streamIds, children }: CoordinatedLoadingProviderProps) {
  const [showSkeleton, setShowSkeleton] = useState(false)
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(false)
  const [isReady, setIsReady] = useState(false)
  // Track which workspace has IDB cache primed. When true, the gate bypasses
  // network checks — IDB has data from a previous session and store hooks
  // return it synchronously via the in-memory cache. The phase system still
  // applies (loading → skeleton → ready) including avatar preload.
  const [primedWorkspaceId, setPrimedWorkspaceId] = useState<string | null>(null)
  const [primedDraftWorkspaceId, setPrimedDraftWorkspaceId] = useState<string | null>(null)
  const idbCachePrimed = primedWorkspaceId === workspaceId
  const initialLoadCompleteRef = useRef(false)
  const loadingIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loggedSuppressedStreamErrorsRef = useRef(new Set<string>())

  // Prime the in-memory cache from IndexedDB on mount. If IDB has workspace
  // data from a previous session, this populates the cache so store hooks
  // return real data on their first synchronous render. When successful, the
  // gate bypasses network wait — IDB IS the source of truth.
  useEffect(() => {
    let cancelled = false
    seedCacheFromIdb(workspaceId).then((hasData) => {
      if (!cancelled && hasData) setPrimedWorkspaceId(workspaceId)
    })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  useEffect(() => {
    let cancelled = false
    seedDraftCacheFromIdb(workspaceId).then(() => {
      if (!cancelled) setPrimedDraftWorkspaceId(workspaceId)
    })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const workspaceSyncStatus = useSyncStatus(`workspace:${workspaceId}`)
  const { loadState: streamsLoadState, results } = useCoordinatedStreamQueries(workspaceId, streamIds)
  const serverStreamIds = useMemo(
    () => streamIds.filter((id) => !id.startsWith("draft_") && !id.startsWith("draft:")),
    [streamIds]
  )

  // When bypassing via IDB cache, verify the data is actually populated —
  // don't just trust the loading flags. usePreloadImages resolves immediately
  // for empty arrays (pre-cache) and then never blocks again, which can cause
  // the gate to open before store hooks have data.
  const idbWorkspace = useWorkspaceFromStore(workspaceId)
  const idbStreams = useWorkspaceStreams(workspaceId)
  const idbUsers = useWorkspaceUsers(workspaceId)
  const idbMemberships = useWorkspaceStreamMemberships(workspaceId)
  const idbDmPeers = useWorkspaceDmPeers(workspaceId)
  const idbPersonas = useWorkspacePersonas(workspaceId)
  const idbBots = useWorkspaceBots(workspaceId)
  const idbUnreadState = useWorkspaceUnreadState(workspaceId)
  const idbMetadata = useWorkspaceMetadata(workspaceId)
  const streamById = useMemo(() => new Map(idbStreams.map((stream) => [stream.id, stream])), [idbStreams])
  const workspaceDataReady =
    hasSeededWorkspaceCache(workspaceId) && !!idbWorkspace && idbUnreadState !== undefined && idbMetadata !== undefined
  const draftDataReady = primedDraftWorkspaceId === workspaceId && hasSeededDraftCache(workspaceId)
  const streamQueryStates = useMemo(
    () =>
      serverStreamIds.map((streamId, index) => {
        const result = results[index]
        const cachedStream = streamById.get(streamId)
        const hasStreamRecord = !!cachedStream || result?.data?.stream?.id === streamId
        const hasEventCache = hasStreamEventCache(streamId) || result?.data !== undefined
        const previewAlignedWithTimeline =
          result?.data !== undefined || hasCachedMessageAtOrAfter(streamId, cachedStream?.lastMessagePreview?.createdAt)
        const hasUsableLocalData = hasStreamRecord && hasEventCache && previewAlignedWithTimeline
        return {
          streamId,
          result,
          hasStreamRecord,
          hasEventCache,
          previewAlignedWithTimeline,
          hasUsableLocalData,
          suppressError: shouldSuppressBootstrapError(result?.error, hasUsableLocalData),
        }
      }),
    [results, serverStreamIds, streamById]
  )
  const visibleStreamIdsReady = streamQueryStates.every((state) => state.hasUsableLocalData)
  const canBypassVisibleStreamNetwork = idbCachePrimed && visibleStreamIdsReady
  const workspaceLoading = !workspaceDataReady && workspaceSyncStatus !== "error"
  const streamsLoading = !canBypassVisibleStreamNetwork && isQueryLoadStateLoading(streamsLoadState)
  const draftsLoading = !draftDataReady
  const suppressedStreamErrors = useMemo(
    () => streamQueryStates.filter((state) => state.suppressError && state.result?.error),
    [streamQueryStates]
  )

  const avatarUrls = useMemo(() => {
    return idbUsers
      .map((u) => getAvatarUrl(workspaceId, u.avatarUrl, 64))
      .filter((url): url is string => url !== undefined)
  }, [idbUsers, workspaceId])
  const avatarsReady = usePreloadImages(avatarUrls)

  const isLoading = workspaceLoading || streamsLoading || draftsLoading

  debugBootstrap("Coordinated loading state", {
    workspaceId,
    streamIds,
    serverStreamIds,
    workspaceSyncStatus,
    streamsLoadState,
    hasSeededWorkspaceCache: hasSeededWorkspaceCache(workspaceId),
    hasSeededDraftCache: hasSeededDraftCache(workspaceId),
    idbCachePrimed,
    workspaceDataReady,
    draftDataReady,
    visibleStreamIdsReady,
    suppressedStreamErrors: suppressedStreamErrors.map((state) => ({
      streamId: state.streamId,
      message: state.result?.error?.message ?? "unknown error",
    })),
    visibleStreamTimelineFreshness: serverStreamIds.map((streamId) => {
      const cachedStream = streamById.get(streamId)
      const cachedEvents = getCachedStreamEvents(streamId)
      return {
        streamId,
        previewCreatedAt: cachedStream?.lastMessagePreview?.createdAt ?? null,
        latestCachedEventCreatedAt: cachedEvents.at(-1)?.createdAt ?? null,
        latestCachedMessageCreatedAt:
          [...cachedEvents]
            .reverse()
            .find((event) => event.eventType === "message_created" || event.eventType === "companion_response")
            ?.createdAt ?? null,
        matchesPreview: hasCachedMessageAtOrAfter(streamId, cachedStream?.lastMessagePreview?.createdAt),
      }
    }),
    workspaceRecordReady: !!idbWorkspace,
    streamCount: idbStreams.length,
    userCount: idbUsers.length,
    membershipCount: idbMemberships.length,
    dmPeerCount: idbDmPeers.length,
    personaCount: idbPersonas.length,
    botCount: idbBots.length,
    hasUnreadState: idbUnreadState !== undefined,
    hasMetadata: idbMetadata !== undefined,
    workspaceLoading,
    streamsLoading,
    draftsLoading,
    isLoading,
    isReady,
    showSkeleton,
    showLoadingIndicator,
  })

  useEffect(() => {
    if (!import.meta.env.DEV) return

    for (const state of suppressedStreamErrors) {
      if (!state.result?.error) continue
      const key = `${workspaceId}:${state.streamId}:${state.result.error.message}`
      if (loggedSuppressedStreamErrorsRef.current.has(key)) continue
      loggedSuppressedStreamErrorsRef.current.add(key)
      console.warn(
        `[CoordinatedLoading] Suppressing stream bootstrap error for ${state.streamId} because cached data is available`,
        state.result.error
      )
    }
  }, [suppressedStreamErrors, workspaceId])

  // Compute phase from state
  const phase = useMemo<CoordinatedPhase>(() => {
    if (isReady) return "ready"
    if (showSkeleton) return "skeleton"
    return "loading"
  }, [isReady, showSkeleton])

  // Mark initial load as complete once data + avatar images are ready
  useEffect(() => {
    if (!isLoading && avatarsReady && !initialLoadCompleteRef.current) {
      initialLoadCompleteRef.current = true
      setIsReady(true)
    }
  }, [isLoading, avatarsReady])

  // Show skeleton after delay if still loading during initial load
  useEffect(() => {
    // Once ready, never show skeleton again
    if (isReady) {
      setShowSkeleton(false)
      return
    }

    if (!isLoading) {
      setShowSkeleton(false)
      return
    }

    const timer = setTimeout(() => {
      setShowSkeleton(true)
    }, LOADING_DELAY_MS)

    return () => clearTimeout(timer)
  }, [isLoading, isReady])

  // Show loading indicator after delay (for slow loads)
  // This shows for both initial loads AND reconnect loads
  useEffect(() => {
    if (isLoading) {
      // Clear any pending hide timeout
      if (hideIndicatorTimerRef.current) {
        clearTimeout(hideIndicatorTimerRef.current)
        hideIndicatorTimerRef.current = null
      }
      // Start timer to show loading indicator after delay
      loadingIndicatorTimerRef.current = setTimeout(() => {
        setShowLoadingIndicator(true)
      }, LOADING_DELAY_MS)
    } else {
      // Clear timer and hide indicator when loading completes
      if (loadingIndicatorTimerRef.current) {
        clearTimeout(loadingIndicatorTimerRef.current)
        loadingIndicatorTimerRef.current = null
      }
      // Small delay before hiding for smooth transition
      hideIndicatorTimerRef.current = setTimeout(() => setShowLoadingIndicator(false), 100)
    }

    return () => {
      if (loadingIndicatorTimerRef.current) {
        clearTimeout(loadingIndicatorTimerRef.current)
      }
      if (hideIndicatorTimerRef.current) {
        clearTimeout(hideIndicatorTimerRef.current)
      }
    }
  }, [isLoading])

  // Build a map of stream states for O(1) lookup
  // Filter out both draft scratchpads (draft_xxx) and draft thread panels (draft:xxx:xxx)
  const streamStateMap = useMemo(() => {
    const map = new Map<string, { isLoading: boolean; error: Error | null }>()

    streamQueryStates.forEach((state) => {
      if (state.streamId && state.result) {
        const loadState = getQueryLoadState(state.result.status, state.result.fetchStatus)
        map.set(state.streamId, {
          isLoading: isQueryLoadStateLoading(loadState) && !state.result.isError,
          error: state.suppressError ? null : (state.result.error ?? null),
        })
      }
    })

    return map
  }, [streamQueryStates])

  // Extract errors for getStreamError
  // Filter out both draft scratchpads (draft_xxx) and draft thread panels (draft:xxx:xxx)
  const streamErrors = useMemo<StreamError[]>(() => {
    return streamQueryStates
      .map((state) => {
        if (!state.result?.error || state.suppressError) return null
        const status = ApiError.isApiError(state.result.error) ? state.result.error.status : 500
        return { streamId: state.streamId, status, error: state.result.error }
      })
      .filter((e): e is StreamError => e !== null)
  }, [streamQueryStates])

  const getStreamState = useMemo(
    () =>
      (streamId: string): StreamState => {
        // During initial load, all streams report "idle" - the global phase controls skeleton display.
        // This is intentional: individual stream loading indicators only appear AFTER initial load.
        if (!isReady) return "idle"

        // Drafts are always idle (no server fetch)
        // Check both draft scratchpads (draft_xxx) and draft thread panels (draft:xxx:xxx)
        if (streamId.startsWith("draft_") || streamId.startsWith("draft:")) return "idle"

        const state = streamStateMap.get(streamId)
        if (!state) return "idle"
        if (state.error) return "error"
        if (state.isLoading) return "loading"
        return "idle"
      },
    [isReady, streamStateMap]
  )

  const getStreamError = useMemo(
    () => (streamId: string) => streamErrors.find((e) => e.streamId === streamId),
    [streamErrors]
  )

  const hasErrors = streamErrors.length > 0

  const value = useMemo<CoordinatedLoadingContextValue>(
    () => ({ phase, hasErrors, getStreamState, getStreamError, isLoading, showLoadingIndicator }),
    [phase, hasErrors, getStreamState, getStreamError, isLoading, showLoadingIndicator]
  )

  return <CoordinatedLoadingContext.Provider value={value}>{children}</CoordinatedLoadingContext.Provider>
}

export function useCoordinatedLoading(): CoordinatedLoadingContextValue {
  const context = useContext(CoordinatedLoadingContext)
  if (!context) {
    throw new Error("useCoordinatedLoading must be used within a CoordinatedLoadingProvider")
  }
  return context
}

interface CoordinatedLoadingGateProps {
  children: ReactNode
}

/**
 * Gate component that shows nothing during the "loading" phase (first ~300ms),
 * then renders children. Only applies during initial load.
 */
export function CoordinatedLoadingGate({ children }: CoordinatedLoadingGateProps) {
  const { phase } = useCoordinatedLoading()

  if (phase === "loading") {
    return null
  }

  return <>{children}</>
}

/**
 * Gate for the main content area (Outlet).
 * Shows skeleton during initial load, then renders children.
 * Individual stream components handle their own loading states after that.
 */
export function MainContentGate({ children }: CoordinatedLoadingGateProps) {
  const { phase, hasErrors } = useCoordinatedLoading()

  // During initial load, show skeleton
  // Exception: if there are errors, render children so error pages can display
  if (phase !== "ready" && !hasErrors) {
    return <StreamContentSkeleton />
  }

  return <>{children}</>
}
