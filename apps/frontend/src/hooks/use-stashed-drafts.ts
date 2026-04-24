import { useCallback, useMemo } from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { db, type DraftAttachment, type StashedDraft } from "@/db"
import type { JSONContent } from "@threa/types"
import { isEmptyContent } from "@/lib/prosemirror-utils"

// Re-exported so components (which cannot import from `@/db` per INV-15) can
// still get the row type they render without reaching into the data layer.
export type { StashedDraft }

/**
 * Generate a stashed-draft ID. The "stash_" prefix is distinct from the
 * "draft_" prefix used by `DraftScratchpad`, so the existing `isDraftId`
 * check in `use-draft-scratchpads` doesn't confuse stashed rows for
 * scratchpads.
 */
export function generateStashId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `stash_${timestamp}${random}`
}

export interface StashDraftInput {
  contentJson: JSONContent
  attachments?: DraftAttachment[]
}

export interface UseStashedDraftsResult {
  /** Stashed drafts for the current scope, newest first. Empty while `scope` is undefined. */
  drafts: StashedDraft[]
  /** True once Dexie has resolved the initial query (used to suppress empty-flash in the picker). */
  isLoaded: boolean
  /**
   * Persist a new stashed draft. Refuses to save when the content is empty
   * and no attachments are present — callers should still honour a no-op
   * locally (e.g. skip the toast) so the UX doesn't confirm a save that
   * didn't happen.
   */
  stashDraft: (input: StashDraftInput) => Promise<StashedDraft | null>
  /** Fetch-and-delete: returns the row so the caller can load it into the composer. */
  restoreStashedDraft: (id: string) => Promise<StashedDraft | null>
  /** Delete without restoring. */
  deleteStashedDraft: (id: string) => Promise<void>
}

/**
 * Persist a new stashed draft. Returns `null` (no DB write) when both the
 * content is empty and there are no attachments — callers should treat the
 * null return as a silent no-op (e.g. skip the confirmation toast).
 */
export async function createStashedDraft(
  workspaceId: string,
  scope: string | undefined,
  input: StashDraftInput
): Promise<StashedDraft | null> {
  if (!workspaceId || !scope) return null
  const hasContent = !isEmptyContent(input.contentJson)
  const hasAttachments = (input.attachments?.length ?? 0) > 0
  if (!hasContent && !hasAttachments) return null

  const row: StashedDraft = {
    id: generateStashId(),
    workspaceId,
    scope,
    contentJson: input.contentJson,
    attachments: input.attachments && input.attachments.length > 0 ? input.attachments : undefined,
    createdAt: Date.now(),
  }
  await db.stashedDrafts.add(row)
  return row
}

/**
 * Fetch-and-delete a stashed draft by id. Returns the row so the caller can
 * hydrate the composer; returns `null` if the id is missing (idempotent).
 *
 * Wrapped in a Dexie rw transaction so the get + delete are atomic against
 * concurrent tabs — without it, two tabs opening the same `?stash=` link
 * could both read the row before either deletes, and both would restore
 * the same content into their composers.
 */
export async function popStashedDraft(id: string): Promise<StashedDraft | null> {
  return db.transaction("rw", db.stashedDrafts, async () => {
    const row = await db.stashedDrafts.get(id)
    if (!row) return null
    await db.stashedDrafts.delete(id)
    return row
  })
}

/** Delete a stashed draft without restoring it. */
export async function deleteStashedDraftById(id: string): Promise<void> {
  await db.stashedDrafts.delete(id)
}

/**
 * Query + mutate stashed drafts for a specific scope (a stream or a thread's
 * parent message). Pass `undefined` for `scope` when the host is still
 * resolving what scope to target — the hook will return an empty list and
 * silently no-op mutations rather than throw.
 *
 * The mutation methods are thin wrappers over the module-level helpers
 * (`createStashedDraft`, `popStashedDraft`, `deleteStashedDraftById`) so the
 * mutation behavior is testable without `renderHook` or mocking
 * `useLiveQuery`.
 */
export function useStashedDrafts(workspaceId: string, scope: string | undefined): UseStashedDraftsResult {
  const live = useLiveQuery(
    async () => {
      if (!workspaceId || !scope) return [] as StashedDraft[]
      const rows = await db.stashedDrafts.where("[workspaceId+scope]").equals([workspaceId, scope]).sortBy("createdAt")
      // Dexie sorts ascending; reverse so newest is first (what the picker wants).
      return rows.reverse()
    },
    [workspaceId, scope],
    undefined
  )

  const drafts = useMemo(() => live ?? [], [live])
  const isLoaded = live !== undefined

  const stashDraft = useCallback(
    (input: StashDraftInput) => createStashedDraft(workspaceId, scope, input),
    [workspaceId, scope]
  )
  const restoreStashedDraft = useCallback((id: string) => popStashedDraft(id), [])
  const deleteStashedDraft = useCallback((id: string) => deleteStashedDraftById(id), [])

  return { drafts, isLoaded, stashDraft, restoreStashedDraft, deleteStashedDraft }
}
