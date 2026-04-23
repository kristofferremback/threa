import type { Querier } from "../../../../db"
import { ContextRefKinds, Visibilities, type ContextRef } from "@threa/types"
import { HttpError } from "../../../../lib/errors"
import { MessageRepository } from "../../../messaging"
import { StreamRepository, StreamMemberRepository } from "../../../streams"
import { UserRepository } from "../../../workspaces"
import { PersonaRepository } from "../../persona-repository"
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
    const stream = await StreamRepository.findById(db, ref.streamId)
    if (!stream || stream.workspaceId !== workspaceId) {
      throw new HttpError("Context source stream not found", { status: 404, code: "CONTEXT_SOURCE_NOT_FOUND" })
    }

    // Threads inherit access from their root stream (channel visibility + membership).
    const accessStream = stream.rootStreamId ? await StreamRepository.findById(db, stream.rootStreamId) : stream
    if (!accessStream) {
      throw new HttpError("Context source stream not found", { status: 404, code: "CONTEXT_SOURCE_NOT_FOUND" })
    }

    if (accessStream.visibility === Visibilities.PUBLIC) {
      return
    }

    const isMember = await StreamMemberRepository.isMember(db, accessStream.id, userId)
    if (!isMember) {
      throw new HttpError("No access to context source stream", { status: 403, code: "CONTEXT_SOURCE_FORBIDDEN" })
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

    // Include the parent (root) message when resolving a thread — the reply
    // chain is almost always unintelligible without the message that spawned
    // it, and we've historically missed this on other context pipelines.
    // Matches `buildThreadContext` (context-builder.ts). Anchors intentionally
    // don't exclude the root: a user asking to narrow to a range of replies
    // still expects the thread's parent to anchor the conversation.
    const withRoot = await prependParentMessage(db, stream, anchored)

    const authorIds = new Set(withRoot.map((m) => m.authorId))
    const authorNames = await resolveAuthorNames(db, stream.workspaceId, authorIds)

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
  const anchor = await MessageRepository.findById(db, anchorId)
  const existsInStream = anchor !== null && anchor.streamId === streamId
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

/**
 * If the source is a thread, load its parent message and prepend it to the
 * fetched replies. Returns the input unchanged when the stream is not a
 * thread, has no parent link, or the parent has been hard-deleted. De-dups
 * in case the fetched window already contains it (shouldn't happen since the
 * parent lives in a different stream, but defensive).
 */
async function prependParentMessage<
  T extends {
    id: string
    authorId: string
    contentMarkdown: string
    sequence: bigint
    createdAt: Date
    editedAt: Date | null
  },
>(db: Querier, stream: { parentMessageId: string | null }, items: T[]): Promise<T[]> {
  if (!stream.parentMessageId) return items
  const parent = await MessageRepository.findById(db, stream.parentMessageId)
  if (!parent) return items
  if (items.some((m) => m.id === parent.id)) return items
  // Parent's sequence is from a different stream, so we can't compare it to
  // our fetched items' sequences directly. That's fine for rendering — the
  // renderer uses the array order we produce here, not the sequence field.
  return [parent as unknown as T, ...items]
}

async function resolveAuthorNames(
  db: Querier,
  workspaceId: string,
  authorIds: Set<string>
): Promise<Map<string, string>> {
  const ids = [...authorIds]
  if (ids.length === 0) return new Map()

  // INV-56: batch lookups rather than looping per-row. Persona rows live in a
  // separate, workspace-agnostic table so we query both in parallel and merge.
  const [users, personas] = await Promise.all([
    UserRepository.findByIds(db, workspaceId, ids),
    PersonaRepository.findByIds(db, ids),
  ])

  const out = new Map<string, string>()
  for (const u of users) out.set(u.id, u.name)
  for (const p of personas) out.set(p.id, p.name)
  return out
}
