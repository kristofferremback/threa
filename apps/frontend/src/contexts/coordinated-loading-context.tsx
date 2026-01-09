import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from "react"
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
  streamErrors: StreamError[]
  getStreamError: (streamId: string) => StreamError | undefined
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

  const { isLoading: workspaceLoading } = useWorkspaceBootstrap(workspaceId)
  const { isLoading: streamsLoading, results } = useCoordinatedStreamQueries(workspaceId, streamIds)

  const isLoading = workspaceLoading || streamsLoading

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
      streamErrors,
      getStreamError,
    }),
    [isLoading, showSkeleton, streamErrors, getStreamError]
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
 * then renders children. Children use useCoordinatedLoading() to
 * determine if they should show skeleton or real content.
 */
export function CoordinatedLoadingGate({ children }: CoordinatedLoadingGateProps) {
  const { isLoading, showSkeleton } = useCoordinatedLoading()

  // First second of loading: show nothing
  if (isLoading && !showSkeleton) {
    return null
  }

  // After 1s (skeleton phase) or ready: render children
  // Children check context to know if they should show skeleton
  return <>{children}</>
}

/**
 * Gate for the main content area (Outlet).
 * Shows stream content skeleton during coordinated loading.
 * When there are stream errors, render children so error pages can show.
 */
export function MainContentGate({ children }: CoordinatedLoadingGateProps) {
  const { isLoading, streamErrors } = useCoordinatedLoading()

  // If there are stream errors, render children so error pages can display
  // This prevents infinite loading when a stream returns 404/403
  const hasStreamErrors = streamErrors.length > 0

  if (isLoading && !hasStreamErrors) {
    return <StreamContentSkeleton />
  }

  return <>{children}</>
}
