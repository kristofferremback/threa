import type { ReactNode } from "react"
import { useStreamError } from "@/hooks/use-stream-error"
import { StreamErrorView } from "./stream-error-view"

interface StreamErrorBoundaryProps {
  /** Stream ID to check for errors */
  streamId: string | undefined
  /** Additional error from direct query (useStreamBootstrap, etc.) */
  queryError?: Error | null
  /** If provided, shows navigation buttons on error page */
  workspaceId?: string
  children: ReactNode
}

/**
 * Wraps content that depends on a stream and handles error display.
 * Checks both coordinated loading errors and direct query errors.
 *
 * Usage:
 * ```tsx
 * <StreamErrorBoundary streamId={streamId} queryError={error} workspaceId={workspaceId}>
 *   <StreamContent ... />
 * </StreamErrorBoundary>
 * ```
 */
export function StreamErrorBoundary({ streamId, queryError, workspaceId, children }: StreamErrorBoundaryProps) {
  const error = useStreamError(streamId, queryError)

  if (error) {
    return <StreamErrorView type={error.type} workspaceId={workspaceId} />
  }

  return <>{children}</>
}
