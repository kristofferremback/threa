import type { JSONContent } from "@threa/types"
import { db, type DraftMessage } from "@/db"
import type { DraftContextRef } from "./types"
import { upsertDraftMessageInCache } from "@/stores/draft-store"
import { getDraftMessageKey } from "@/hooks/use-draft-message"

const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }

/**
 * Seed a stream's draft IDB row with a context-ref sidecar entry. Used by
 * `useDiscussWithAriadne` so when the user lands on the freshly-created
 * scratchpad, the composer's `<ContextRefStrip>` already renders the
 * attached thread reference — atomic with whatever the user types into
 * the (empty) draft body.
 *
 * Writes both IDB (durable) and the in-memory draft cache (so the
 * composer picks it up on first render without waiting on Dexie's async
 * load). The sidecar is what survives across composer-internal state
 * changes; the server bag at `GET /streams/:id/context-bag` is the
 * fallback once the draft is cleared on send.
 *
 * Status starts as `"ready"` on the assumption that the backend's
 * `ContextBagPrecomputeHandler` is warming `context_summaries` in
 * parallel via the `stream:created` outbox event. If the cache misses
 * later (drift or race), `resolveBagForStream` falls back to inline
 * summarization on the first turn — slower but correct.
 */
export async function seedDraftWithContextRef(params: {
  workspaceId: string
  streamId: string
  ref: DraftContextRef
}): Promise<void> {
  const { workspaceId, streamId, ref } = params
  const draftKey = getDraftMessageKey({ type: "stream", streamId })

  const draft: DraftMessage = {
    id: draftKey,
    workspaceId,
    contentJson: EMPTY_DOC,
    attachments: [],
    contextRefs: [ref],
    updatedAt: Date.now(),
  }

  await db.draftMessages.put(draft)
  upsertDraftMessageInCache(workspaceId, draft)
}
