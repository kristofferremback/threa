import { api } from "./client"
import type { ContextBag, ContextIntent, ContextRef, ContextRefKind } from "@threa/types"

/**
 * Per-ref result from `POST /context-bag/precompute`.
 *
 * `status: "ready"` means the server wrote a summary row into
 * `context_summaries` and the first real turn will hit the cache;
 * `"inline"` means the ref fit under the intent's inline-char threshold
 * and will be inlined at render time instead. Composer chips treat both
 * as "safe to send."
 */
export interface PrecomputedRefResult {
  kind: ContextRefKind
  refKey: string
  fingerprint: string
  tailMessageId: string | null
  status: "ready" | "inline"
  itemCount: number
  inlineChars: number
}

interface PrecomputeResponse {
  refs: PrecomputedRefResult[]
}

export interface PrecomputeInput {
  intent: ContextIntent
  refs: ContextRef[]
}

export const contextBagApi = {
  /**
   * Pre-warm the shared summary cache for a set of refs before the user
   * sends their first message. The server returns one status entry per ref
   * so a composer chip can flip from "pending" to "ready" / "inline"
   * before `POST /streams` fires. No `ContextBag` row is written by this
   * endpoint — the bag is persisted atomically with the stream on first
   * send via the existing `contextBag` payload on `POST /streams`.
   */
  async precompute(workspaceId: string, input: PrecomputeInput): Promise<PrecomputeResponse> {
    return api.post<PrecomputeResponse>(`/api/workspaces/${workspaceId}/context-bag/precompute`, input)
  },
}

export type { ContextBag }
