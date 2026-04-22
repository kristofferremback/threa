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
    const anchored = applyAnchors(messages, ref)

    const authorIds = new Set(anchored.map((m) => m.authorId))
    const authorNames = await resolveAuthorNames(db, stream.workspaceId, authorIds)

    const items: RenderableMessage[] = anchored.map((m) => ({
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

function applyAnchors<T extends { id: string; sequence: bigint }>(messages: T[], ref: ThreadRef): T[] {
  if (!ref.fromMessageId && !ref.toMessageId) return messages

  const fromIdx = ref.fromMessageId ? messages.findIndex((m) => m.id === ref.fromMessageId) : 0
  const toIdx = ref.toMessageId ? messages.findIndex((m) => m.id === ref.toMessageId) : messages.length - 1

  if (fromIdx < 0 || toIdx < 0) return messages
  const [lo, hi] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]
  return messages.slice(lo, hi + 1)
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
