import type { Querier } from "../../../db"
import { type JSONContent } from "@threa/types"
import { MessageRepository, type Message } from "../repository"

/**
 * Hydrated payload for a single shared-message reference. The frontend
 * overlays this data onto the inline `sharedMessage` node at render time.
 *
 * In Slice 1 we emit one of: full content, deleted-tombstone, or missing.
 * Slice 2 will add a per-viewer `{ private: true, sourceStreamKind, ... }`
 * placeholder for non-ancestor cross-stream shares (D8).
 */
export type HydratedSharedMessage =
  | {
      state: "ok"
      messageId: string
      streamId: string
      authorId: string
      authorType: string
      contentJson: JSONContent
      contentMarkdown: string
      editedAt: Date | null
      createdAt: Date
    }
  | { state: "deleted"; messageId: string; deletedAt: Date }
  | { state: "missing"; messageId: string }

/**
 * Walk a ProseMirror content tree and add every `sharedMessage` node's
 * referenced `messageId` to `into`. Exported so stream event projections
 * can scan `message_created` / `message_edited` payload content alongside
 * direct Message[] inputs.
 */
export function collectSharedMessageIds(node: JSONContent | undefined, into: Set<string>): void {
  if (!node) return
  if (node.type === "sharedMessage") {
    const messageId = (node.attrs as { messageId?: string } | undefined)?.messageId
    if (messageId) into.add(messageId)
  }
  if (node.content) {
    for (const child of node.content) {
      collectSharedMessageIds(child, into)
    }
  }
}

/**
 * Fetch source messages for each id and emit a `{ sourceMessageId →
 * HydratedSharedMessage }` map. Runs one batched `WHERE id IN (...)`
 * against `messages` regardless of input size (INV-56).
 */
export async function hydrateSharedMessageIds(
  db: Querier,
  sourceMessageIds: Iterable<string>
): Promise<Record<string, HydratedSharedMessage>> {
  const ids = Array.from(new Set(sourceMessageIds))
  if (ids.length === 0) return {}

  const byId = await MessageRepository.findByIds(db, ids)

  const result: Record<string, HydratedSharedMessage> = {}
  for (const id of ids) {
    const source = byId.get(id)
    if (!source) {
      result[id] = { state: "missing", messageId: id }
      continue
    }
    if (source.deletedAt) {
      result[id] = { state: "deleted", messageId: id, deletedAt: source.deletedAt }
      continue
    }
    result[id] = {
      state: "ok",
      messageId: source.id,
      streamId: source.streamId,
      authorId: source.authorId,
      authorType: source.authorType,
      contentJson: source.contentJson,
      contentMarkdown: source.contentMarkdown,
      editedAt: source.editedAt,
      createdAt: source.createdAt,
    }
  }
  return result
}

/**
 * Convenience: hydrate from a list of already-loaded messages. Scans each
 * message's `contentJson` for share-node references then delegates to
 * `hydrateSharedMessageIds`.
 */
export async function hydrateSharedMessages(
  db: Querier,
  messages: readonly Message[]
): Promise<Record<string, HydratedSharedMessage>> {
  const ids = new Set<string>()
  for (const msg of messages) {
    collectSharedMessageIds(msg.contentJson, ids)
  }
  return hydrateSharedMessageIds(db, ids)
}
