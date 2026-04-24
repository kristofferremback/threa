import type { JSONContent } from "@threa/types"
import { db, type DraftMessage } from "@/db"
import { upsertDraftMessageInCache } from "@/stores/draft-store"
import { getDraftMessageKey } from "@/hooks/use-draft-message"
import type { ContextRefChipAttrs } from "@/components/editor/context-ref-chip-extension"

/**
 * Build a composer doc containing a single pre-attached context-ref chip
 * followed by an empty paragraph (so the caret lands in a type-friendly spot
 * on mount).
 */
export function buildChipSeedDoc(attrs: ContextRefChipAttrs): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "contextRefChip", attrs: attrs as unknown as Record<string, unknown> },
          { type: "text", text: " " },
        ],
      },
    ],
  }
}

/**
 * Seed a stream's draft IDB row with a composer doc that contains a single
 * context-ref chip. Used by `useDiscussWithAriadne` so when the user lands
 * on the freshly-created scratchpad, the composer already shows what was
 * attached — no extra nav-state plumbing needed.
 *
 * Writes both IDB (durable) and the in-memory draft cache (so the composer
 * picks it up on first render without waiting on Dexie's async load). Safe
 * to call concurrently with the target page mount; `useDraftComposer`
 * de-duplicates via `hasInitialized` on first render.
 *
 * Status starts as `"ready"` on the assumption that the backend's
 * `ContextBagPrecomputeHandler` will warm `context_summaries` on the
 * `stream:created` outbox event — by the time the user types and sends,
 * `resolveBagForStream` hits the cache. If the cache misses (drift or
 * race), the first turn's resolver falls back to inline summarization,
 * which is slower but correct.
 */
export async function seedDraftWithContextRefChip(params: {
  workspaceId: string
  streamId: string
  chip: ContextRefChipAttrs
}): Promise<void> {
  const { workspaceId, streamId, chip } = params
  const draftKey = getDraftMessageKey({ type: "stream", streamId })

  const doc = buildChipSeedDoc(chip)
  const draft: DraftMessage = {
    id: draftKey,
    workspaceId,
    contentJson: doc,
    attachments: [],
    updatedAt: Date.now(),
  }

  await db.draftMessages.put(draft)
  upsertDraftMessageInCache(workspaceId, draft)
}
