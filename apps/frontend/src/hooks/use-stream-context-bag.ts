import { useQuery } from "@tanstack/react-query"
import { contextBagApi, type StreamContextBagResponse } from "@/api"

const EMPTY_RESPONSE: StreamContextBagResponse = { bag: null, refs: [] }

/**
 * Cache key shared between fetchers + invalidators.
 *
 * Keyed on (workspaceId, streamId) — the bag is stream-scoped per INV-57
 * and the underlying table doesn't carry a workspace key, so the workspace
 * scope here is just for cross-workspace cache isolation.
 */
export const streamContextBagKey = (workspaceId: string, streamId: string) =>
  ["streamContextBag", workspaceId, streamId] as const

/**
 * Fetch the persisted ContextBag for a stream so the composer strip can
 * render a chip even after the user reloads, returns to the scratchpad
 * later, or hasn't yet seeded a draft sidecar.
 *
 * Returns `{bag: null, refs: []}` for streams without an attached bag —
 * lets callers render an "empty strip" branch without an extra
 * "is this stream bag-attached?" probe.
 */
export function useStreamContextBag(workspaceId: string, streamId: string | null | undefined) {
  return useQuery({
    queryKey: streamId ? streamContextBagKey(workspaceId, streamId) : ["streamContextBag", workspaceId, "none"],
    queryFn: () => (streamId ? contextBagApi.getForStream(workspaceId, streamId) : Promise.resolve(EMPTY_RESPONSE)),
    enabled: Boolean(streamId),
    staleTime: 60_000,
  })
}
