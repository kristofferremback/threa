import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from "react"
import { useWorkspaceBootstrap } from "@/hooks/use-workspaces"
import { useCoordinatedStreamQueries } from "@/hooks/use-coordinated-stream-queries"
import { StreamContentSkeleton } from "@/components/loading"

interface CoordinatedLoadingContextValue {
  isLoading: boolean
  showSkeleton: boolean
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
  const { isLoading: streamsLoading } = useCoordinatedStreamQueries(workspaceId, streamIds)

  const isLoading = workspaceLoading || streamsLoading

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
    }),
    [isLoading, showSkeleton]
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
 */
export function MainContentGate({ children }: CoordinatedLoadingGateProps) {
  const { isLoading } = useCoordinatedLoading()

  if (isLoading) {
    return <StreamContentSkeleton />
  }

  return <>{children}</>
}
