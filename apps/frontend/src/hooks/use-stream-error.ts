import { useMemo } from "react"
import { useCoordinatedLoading } from "@/contexts"
import { ApiError } from "@/api/client"

export type StreamErrorType = "not-found" | "forbidden"

export interface StreamError {
  type: StreamErrorType
  status: number
}

function getErrorType(status: number): StreamErrorType | null {
  switch (status) {
    case 404:
      return "not-found"
    case 403:
      return "forbidden"
    default:
      return null
  }
}

/**
 * Consolidates stream error checking from multiple sources.
 * Checks coordinated loading errors first (already fetched), then falls back to direct query errors.
 */
export function useStreamError(streamId: string | undefined, queryError?: Error | null): StreamError | null {
  const { getStreamError } = useCoordinatedLoading()

  return useMemo(() => {
    // Check coordinated loading errors first (faster path, already fetched)
    if (streamId) {
      const coordinatedError = getStreamError(streamId)
      if (coordinatedError) {
        const type = getErrorType(coordinatedError.status)
        if (type) {
          return { type, status: coordinatedError.status }
        }
      }
    }

    // Fallback to direct query error
    if (queryError && ApiError.isApiError(queryError)) {
      const type = getErrorType(queryError.status)
      if (type) {
        return { type, status: queryError.status }
      }
    }

    return null
  }, [streamId, getStreamError, queryError])
}
