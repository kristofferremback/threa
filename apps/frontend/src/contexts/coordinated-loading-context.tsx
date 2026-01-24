import { createContext, useContext, useState, useEffect, useMemo, useRef, type ReactNode } from "react"
import { useWorkspaceBootstrap } from "@/hooks/use-workspaces"
import { useCoordinatedStreamQueries } from "@/hooks/use-coordinated-stream-queries"
import { StreamContentSkeleton } from "@/components/loading"
import { ApiError } from "@/api/client"

interface StreamError {
  streamId: string
  status: number
  error: Error
}

interface CoordinatedLoadingContextValue {
  isLoading: boolean
  showSkeleton: boolean
  hasCompletedInitialLoad: boolean
  streamErrors: StreamError[]
  getStreamError: (streamId: string) => StreamError | undefined
  isStreamLoading: (streamId: string) => boolean
}

const CoordinatedLoadingContext = createContext<CoordinatedLoadingContextValue | null>(null)

interface CoordinatedLoadingProviderProps {
  workspaceId: string
  streamIds: string[]
  children: ReactNode
}

const SKELETON_DELAY_MS = 1000

export function CoordinatedLoadingProvider({ workspaceId, streamIds, children }: CoordinatedLoadingProviderProps) {
  const [showSkeleton, setShowSkeleton] = useState(false)
  const [hasCompletedInitialLoad, setHasCompletedInitialLoad] = useState(false)
  const initialLoadCompleteRef = useRef(false)

  const { isLoading: workspaceLoading } = useWorkspaceBootstrap(workspaceId)
  const { isLoading: streamsLoading, results } = useCoordinatedStreamQueries(workspaceId, streamIds)

  const isLoading = workspaceLoading || streamsLoading

  // Track which individual streams are currently loading
  const loadingStreamIds = useMemo(() => {
    const serverStreamIds = streamIds.filter((id) => !id.startsWith("draft_"))
    const loading = new Set<string>()
    results.forEach((result, index) => {
      if (result.isLoading && !result.isError) {
        loading.add(serverStreamIds[index])
      }
    })
    return loading
  }, [results, streamIds])

  const isStreamLoading = useMemo(() => (streamId: string) => loadingStreamIds.has(streamId), [loadingStreamIds])

  // Mark initial load as complete once loading finishes for the first time
  useEffect(() => {
    if (!isLoading && !initialLoadCompleteRef.current) {
      initialLoadCompleteRef.current = true
      setHasCompletedInitialLoad(true)
    }
  }, [isLoading])

  // Extract errors from stream query results
  const streamErrors = useMemo<StreamError[]>(() => {
    // Filter out draft IDs from streamIds to match the results array
    const serverStreamIds = streamIds.filter((id) => !id.startsWith("draft_"))
    return results
      .map((result, index) => {
        if (!result.error) return null
        const streamId = serverStreamIds[index]
        const status = ApiError.isApiError(result.error) ? result.error.status : 500
        return { streamId, status, error: result.error }
      })
      .filter((e): e is StreamError => e !== null)
  }, [results, streamIds])

  const getStreamError = useMemo(
    () => (streamId: string) => streamErrors.find((e) => e.streamId === streamId),
    [streamErrors]
  )

  // Show skeleton after delay if still loading
  useEffect(() => {
    if (!isLoading) {
      setShowSkeleton(false)
      return
    }

    const timer = setTimeout(() => {
      setShowSkeleton(true)
    }, SKELETON_DELAY_MS)

    return () => clearTimeout(timer)
  }, [isLoading])

  const value = useMemo<CoordinatedLoadingContextValue>(
    () => ({
      isLoading,
      showSkeleton: isLoading && showSkeleton,
      hasCompletedInitialLoad,
      streamErrors,
      getStreamError,
      isStreamLoading,
    }),
    [isLoading, showSkeleton, hasCompletedInitialLoad, streamErrors, getStreamError, isStreamLoading]
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
 * Gate component that shows nothing while loading (for up to 1s),
 * but ONLY during initial load. After initial load completes,
 * always renders children immediately.
 */
export function CoordinatedLoadingGate({ children }: CoordinatedLoadingGateProps) {
  const { isLoading, showSkeleton, hasCompletedInitialLoad } = useCoordinatedLoading()

  // Only blank the UI during initial load's first second.
  // After initial load completes, always render children immediately.
  if (isLoading && !showSkeleton && !hasCompletedInitialLoad) {
    return null
  }

  return <>{children}</>
}

/**
 * Gate for the main content area (Outlet).
 * Shows stream content skeleton ONLY during initial coordinated loading.
 * After initial load completes, renders children immediately and lets
 * individual stream components handle their own loading states.
 */
export function MainContentGate({ children }: CoordinatedLoadingGateProps) {
  const { isLoading, hasCompletedInitialLoad, streamErrors } = useCoordinatedLoading()

  // If there are stream errors, render children so error pages can display
  // This prevents infinite loading when a stream returns 404/403
  const hasStreamErrors = streamErrors.length > 0

  // Only block rendering during initial load. After initial load completes,
  // always render children - stream components will show their own loading states.
  if (isLoading && !hasCompletedInitialLoad && !hasStreamErrors) {
    return <StreamContentSkeleton />
  }

  return <>{children}</>
}
