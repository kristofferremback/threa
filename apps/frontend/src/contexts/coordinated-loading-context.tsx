import { createContext, useContext, useState, useEffect, useMemo, useRef, type ReactNode } from "react"
import { useWorkspaceBootstrap } from "@/hooks/use-workspaces"
import { useCoordinatedStreamQueries } from "@/hooks/use-coordinated-stream-queries"
import { debugBootstrap } from "@/lib/bootstrap-debug"
import { StreamContentSkeleton } from "@/components/loading"
import { ApiError } from "@/api/client"

/**
 * Global coordinated loading phase - only applies during initial app load.
 * - "loading": First ~1s of initial load, UI shows blank
 * - "skeleton": After ~1s, UI shows skeleton placeholders
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

const LOADING_DELAY_MS = 1000

export function CoordinatedLoadingProvider({ workspaceId, streamIds, children }: CoordinatedLoadingProviderProps) {
  const [showSkeleton, setShowSkeleton] = useState(false)
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const initialLoadCompleteRef = useRef(false)
  const loadingIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { isLoading: workspaceLoading } = useWorkspaceBootstrap(workspaceId)
  const { isLoading: streamsLoading, results } = useCoordinatedStreamQueries(workspaceId, streamIds)

  const isLoading = workspaceLoading || streamsLoading

  debugBootstrap("Coordinated loading state", {
    workspaceId,
    streamIds,
    workspaceLoading,
    streamsLoading,
    isLoading,
    isReady,
    showSkeleton,
    showLoadingIndicator,
  })

  // Compute phase from state
  const phase = useMemo<CoordinatedPhase>(() => {
    if (isReady) return "ready"
    if (showSkeleton) return "skeleton"
    return "loading"
  }, [isReady, showSkeleton])

  // Mark initial load as complete once loading finishes for the first time
  useEffect(() => {
    if (!isLoading && !initialLoadCompleteRef.current) {
      initialLoadCompleteRef.current = true
      setIsReady(true)
    }
  }, [isLoading])

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
    const serverStreamIds = streamIds.filter((id) => !id.startsWith("draft_") && !id.startsWith("draft:"))
    const map = new Map<string, { isLoading: boolean; error: Error | null }>()

    results.forEach((result, index) => {
      const streamId = serverStreamIds[index]
      if (streamId) {
        map.set(streamId, {
          isLoading: result.isLoading && !result.isError,
          error: result.error ?? null,
        })
      }
    })

    return map
  }, [results, streamIds])

  // Extract errors for getStreamError
  // Filter out both draft scratchpads (draft_xxx) and draft thread panels (draft:xxx:xxx)
  const streamErrors = useMemo<StreamError[]>(() => {
    const serverStreamIds = streamIds.filter((id) => !id.startsWith("draft_") && !id.startsWith("draft:"))
    return results
      .map((result, index) => {
        if (!result.error) return null
        const streamId = serverStreamIds[index]
        const status = ApiError.isApiError(result.error) ? result.error.status : 500
        return { streamId, status, error: result.error }
      })
      .filter((e): e is StreamError => e !== null)
  }, [results, streamIds])

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
 * Gate component that shows nothing during the "loading" phase (first ~1s),
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
