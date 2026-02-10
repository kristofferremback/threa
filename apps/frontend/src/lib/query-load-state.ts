import type { FetchStatus, QueryStatus } from "@tanstack/react-query"
import { ApiError } from "@/api/client"

export const QUERY_LOAD_STATE = {
  PENDING: "pending",
  FETCHING: "fetching",
  READY: "ready",
  ERROR: "error",
} as const

export type QueryLoadState = (typeof QUERY_LOAD_STATE)[keyof typeof QUERY_LOAD_STATE]

/**
 * Normalize TanStack Query status/fetchStatus into a single load state.
 * This avoids spreading brittle boolean combinations (`isLoading`, `isPending`) across call sites.
 */
export function getQueryLoadState(status: QueryStatus, fetchStatus: FetchStatus): QueryLoadState {
  if (status === "error") return QUERY_LOAD_STATE.ERROR
  if (status === "success") return QUERY_LOAD_STATE.READY
  if (fetchStatus === "fetching") return QUERY_LOAD_STATE.FETCHING
  return QUERY_LOAD_STATE.PENDING
}

export function isQueryLoadStateLoading(state: QueryLoadState): boolean {
  return state === QUERY_LOAD_STATE.PENDING || state === QUERY_LOAD_STATE.FETCHING
}

export function isTerminalBootstrapError(error: unknown): boolean {
  return ApiError.isApiError(error) && (error.status === 403 || error.status === 404)
}
