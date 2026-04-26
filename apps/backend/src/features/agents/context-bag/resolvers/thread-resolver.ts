import type { Querier } from "../../../../db"
import { ContextRefKinds, type ContextRef } from "@threa/types"
import { HttpError } from "../../../../lib/errors"
import { MessageRepository } from "../../../messaging"
import { StreamRepository, checkStreamAccess } from "../../../streams"
import { resolveActorNames } from "../../actor-names"
import { fingerprintContent, fingerprintManifest as fingerprintInputs } from "../fingerprint"
import type { RenderableMessage, Resolver, SummaryInput } from "../types"

type ThreadRef = Extract<ContextRef, { kind: typeof ContextRefKinds.THREAD }>

const MAX_FETCH = 500

/**
 * Thread resolver: materializes a thread/scratchpad/channel reference into the
 * inputs manifest + renderable messages the renderer/summarizer need.
 *
 * Access check: the user must be able to see the source stream. Public channels
 * are readable by any workspace member; private streams require membership on
 * the stream or on the root stream (threads inherit root membership).
 */
export const ThreadResolver: Resolver<ThreadRef> = {
  kind: ContextRefKinds.THREAD,

  canonicalKey(ref) {
    return `thread:${ref.streamId}`
  },

  async assertAccess(db, ref, userId, workspaceId) {
    // Single source of truth for "can this user read this stream?": handles
    // workspace-boundary, public-channel, and thread-inherits-from-root cases.
    // Inlining `StreamMemberRepository.isMember` here is the historical footgun
    // (membership ≠ access).
    const stream = await checkStreamAccess(db, ref.streamId, workspaceId, userId)
    if (!stream) {
      // We don't know whether the source is missing, in another workspace, or
      // just inaccessible — pick FORBIDDEN as the safer default so we don't
      // confirm existence of streams the user can't see. Callers that need a
      // 404 vs 403 distinction can re-check with `StreamRepository.findById`.
      throw new HttpError("No access to context source stream", {
        status: 403,
        code: "CONTEXT_SOURCE_FORBIDDEN",
      })
    }
  },

  async fetch(db, ref) {
    const stream = await StreamRepository.findById(db, ref.streamId)
    if (!stream) {
      throw new HttpError("Context source stream not found", { status: 404, code: "CONTEXT_SOURCE_NOT_FOUND" })
    }

    const messages = await MessageRepository.list(db, ref.streamId, { limit: MAX_FETCH })

    // Apply optional anchoring. `fromMessageId`/`toMessageId` bound the slice
    // by sequence so the bag can pin down a specific range of the thread.
    const anchored = await applyAnchors(db, messages, ref)

    // Always prepend the thread's root message when the source is a thread —
    // the reply chain is unintelligible without the message that spawned it.
    // Anchors intentionally don't exclude the root: a user narrowing to a
    // range of replies still expects the parent to anchor the conversation.
    // `findThreadRoot` is the canonical helper for this — it filters
    // soft-deleted roots and returns null for non-threads.
    const root = await MessageRepository.findThreadRoot(db, stream)
    const withRoot = root && !anchored.some((m) => m.id === root.id) ? [root, ...anchored] : anchored

    const authorIds = new Set(withRoot.map((m) => m.authorId))
    const authorNames = await resolveActorNames(db, stream.workspaceId, authorIds)

    const items: RenderableMessage[] = withRoot.map((m) => ({
      messageId: m.id,
      authorId: m.authorId,
      authorName: authorNames.get(m.authorId) ?? "Unknown",
      contentMarkdown: m.contentMarkdown,
      createdAt: m.createdAt.toISOString(),
      editedAt: m.editedAt?.toISOString() ?? null,
      sequence: m.sequence,
    }))

    const inputs: SummaryInput[] = items.map((item) => ({
      messageId: item.messageId,
      contentFingerprint: fingerprintContent(item.contentMarkdown),
      editedAt: item.editedAt,
      deleted: false,
    }))

    const fingerprint = fingerprintInputs(inputs)
    const tail = items[items.length - 1]

    return {
      items,
      inputs,
      fingerprint,
      tailMessageId: tail?.messageId ?? null,
    }
  },
}

async function applyAnchors<T extends { id: string; sequence: bigint; streamId?: string }>(
  db: Querier,
  messages: T[],
  ref: ThreadRef
): Promise<T[]> {
  if (!ref.fromMessageId && !ref.toMessageId) return messages

  const fromIdx = ref.fromMessageId ? messages.findIndex((m) => m.id === ref.fromMessageId) : 0
  const toIdx = ref.toMessageId ? messages.findIndex((m) => m.id === ref.toMessageId) : messages.length - 1

  // Fail loudly when an anchor can't be located in the fetched window — the
  // caller asked for a narrowed slice and we'd rather surface the mismatch
  // than silently widen to the full (already possibly truncated) window.
  // Distinguish two cases so the frontend can either surface a crisp error
  // (unknown anchor) or propose a workaround (widen the fetch window):
  //   - CONTEXT_ANCHOR_NOT_FOUND — the id doesn't exist in this stream at all
  //   - CONTEXT_ANCHOR_OUT_OF_WINDOW — the id exists but predates MAX_FETCH
  if (ref.fromMessageId && fromIdx < 0) {
    await assertAnchorExists(db, ref.streamId, ref.fromMessageId, "fromMessageId")
  }
  if (ref.toMessageId && toIdx < 0) {
    await assertAnchorExists(db, ref.streamId, ref.toMessageId, "toMessageId")
  }

  const [lo, hi] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]
  return messages.slice(lo, hi + 1)
}

async function assertAnchorExists(
  db: Querier,
  streamId: string,
  anchorId: string,
  label: "fromMessageId" | "toMessageId"
): Promise<never> {
  // `MessageRepository.findById` does NOT filter `deleted_at`, but
  // `MessageRepository.list` (which produced the search window) does. So a
  // soft-deleted anchor would otherwise look like a live row and get
  // mis-labeled OUT_OF_WINDOW — the suggested workaround (widen the window)
  // can never recover it. Treat soft-deleted anchors as not-found.
  const anchor = await MessageRepository.findById(db, anchorId)
  const existsInStream = anchor !== null && anchor.streamId === streamId && !anchor.deletedAt
  if (!existsInStream) {
    throw new HttpError(`${label} anchor not found in this stream`, {
      status: 422,
      code: "CONTEXT_ANCHOR_NOT_FOUND",
    })
  }
  throw new HttpError(`${label} anchor exists but predates the fetched window (MAX_FETCH=${MAX_FETCH})`, {
    status: 422,
    code: "CONTEXT_ANCHOR_OUT_OF_WINDOW",
  })
}
