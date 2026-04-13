import { isRecoverableBootstrapError } from "./query-load-state"

/**
 * Retry configuration for stream bootstrap queries.
 *
 * Transient errors (5xx, 429, network failures) must self-heal — otherwise a
 * single failed fetch on navigation leaves the stream stuck empty until the
 * user reloads (INV-53 intent is continuous availability). Terminal 403/404
 * stays terminal to avoid loops on deleted or forbidden streams, and other
 * non-recoverable client errors (e.g. 400) also skip retry so we surface the
 * error immediately rather than hammering the server.
 */
const MAX_BOOTSTRAP_RETRIES = 2
const BOOTSTRAP_RETRY_BASE_DELAY_MS = 500
const BOOTSTRAP_RETRY_MAX_DELAY_MS = 4000

export function bootstrapRetry(failureCount: number, error: Error): boolean {
  if (!isRecoverableBootstrapError(error)) return false
  return failureCount < MAX_BOOTSTRAP_RETRIES
}

export function bootstrapRetryDelay(attempt: number): number {
  return Math.min(BOOTSTRAP_RETRY_BASE_DELAY_MS * 2 ** attempt, BOOTSTRAP_RETRY_MAX_DELAY_MS)
}

/**
 * Shared React Query options for stream bootstrap queries.
 *
 * `useCoordinatedStreamQueries` (via `useQueries`) and `useStreamBootstrap`
 * (via `useQuery`) share the same query key — keeping their options aligned
 * prevents observer thrash when they co-mount (divergent options on the same
 * key cause refetch loops).
 *
 * `structuralSharing: false` because `useQueries` creates new query objects
 * when the stream list changes; structural sharing can retain stale references
 * across rebuilds.
 */
export const STREAM_BOOTSTRAP_QUERY_OPTIONS = {
  staleTime: Infinity,
  gcTime: Infinity,
  retry: bootstrapRetry,
  retryDelay: bootstrapRetryDelay,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  structuralSharing: false,
} as const
