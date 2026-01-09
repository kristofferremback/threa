import { useMemo } from "react"
import { useCoordinatedLoading } from "@/contexts"
import { ApiError } from "@/api/client"

export type StreamErrorType = "not-found" | "forbidden" | "error"

export interface StreamError {
  type: StreamErrorType
  status: number | null
}

function getErrorType(status: number): StreamErrorType {
  switch (status) {
    case 404:
      return "not-found"
    case 403:
      return "forbidden"
    default:
      return "error"
  }
}

/**
 * Consolidates stream error checking from multiple sources.
 * Checks coordinated loading errors first (already fetched), then falls back to direct query errors.
 * Returns appropriate error type for 404/403, or generic "error" for other failures.
 */
export function useStreamError(streamId: string | undefined, queryError?: Error | null): StreamError | null {
  const { getStreamError } = useCoordinatedLoading()

  return useMemo(() => {
    // Check coordinated loading errors first (faster path, already fetched)
    if (streamId) {
      const coordinatedError = getStreamError(streamId)
      if (coordinatedError) {
        return {
          type: getErrorType(coordinatedError.status),
          status: coordinatedError.status,
        }
      }
    }

    // Fallback to direct query error
    if (queryError) {
      if (ApiError.isApiError(queryError)) {
        return {
          type: getErrorType(queryError.status),
          status: queryError.status,
        }
      }
      // Non-API errors (network failures, etc.) - treat as generic error
      return { type: "error", status: null }
    }

    return null
  }, [streamId, getStreamError, queryError])
}
