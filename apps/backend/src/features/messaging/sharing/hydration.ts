import type { Querier } from "../../../db"
import { type JSONContent, type StreamType, type Visibility, StreamTypes } from "@threa/types"
import { MessageRepository, type Message } from "../repository"
import { resolveActorNames } from "../../agents"
import { listAccessibleStreamIds, StreamRepository, type Stream } from "../../streams"
import { SharedMessageRepository } from "./repository"

/**
 * Hard cap on how many nested pointer levels we'll resolve in one read.
 * Realistically chains rarely exceed 1–2 hops; the cap exists to keep the
 * cost of pathological data bounded. Pointers beyond the cap render as a
 * `truncated` placeholder linking to the source stream so the viewer can
 * keep reading there. See `docs/plans/message-sharing-streams.md` (Pointer
 * hydration on message fetch).
 */
export const MAX_HYDRATION_DEPTH = 3

/**
 * Hydrated payload for a single shared-message reference. The frontend
 * overlays this data onto the inline `sharedMessage` node at render time.
 *
 * Variants:
 * - `ok`: viewer has access; current source content is inlined.
 * - `deleted`: source row exists but is tombstoned.
 * - `missing`: source row never existed (defended for; shouldn't normally
 *   happen because shares are recorded against existing source ids).
 * - `private`: viewer has no read path to the source — reveals only the
 *   source stream's `kind` + `visibility`, never content/author/name. Used
 *   for re-share chains where a downstream viewer can see the outer
 *   pointer but not an inner one (plan D8).
 * - `truncated`: hydration stopped at `MAX_HYDRATION_DEPTH` for an
 *   accessible chain; viewer can navigate to `streamId` to keep reading.
 */
export type HydratedSharedMessage =
  | {
      state: "ok"
      messageId: string
      streamId: string
      authorId: string
      authorType: string
      authorName: string | null
      contentJson: JSONContent
      contentMarkdown: string
      editedAt: Date | null
      createdAt: Date
    }
  | { state: "deleted"; messageId: string; deletedAt: Date }
  | { state: "missing"; messageId: string }
  | {
      state: "private"
      messageId: string
      sourceStreamKind: StreamType
      sourceVisibility: Visibility
    }
  | { state: "truncated"; messageId: string; streamId: string }

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
 * Like {@link collectSharedMessageIds} but also captures each ref's
 * cached `streamId` from the node attrs. Used during recursive hydration
 * so a pointer beyond the depth cap can render a "Open in source stream"
 * link without a per-ref DB lookup.
 */
function collectSharedMessageRefs(node: JSONContent | undefined, into: Map<string, string>): void {
  if (!node) return
  if (node.type === "sharedMessage") {
    const attrs = node.attrs as { messageId?: string; streamId?: string } | undefined
    if (attrs?.messageId && attrs.streamId) into.set(attrs.messageId, attrs.streamId)
  }
  if (node.content) {
    for (const child of node.content) {
      collectSharedMessageRefs(child, into)
    }
  }
}

/**
 * Resolve the (kind, visibility) the `private` placeholder should report.
 * For thread sources we surface the parent's kind/visibility so the
 * placeholder vocabulary stays in {channel, dm, scratchpad} per plan D8 —
 * "thread" by itself wouldn't tell the viewer what kind of stream sits
 * behind the wall.
 */
function resolveSourceForPrivatePlaceholder(
  source: Stream,
  byStreamId: ReadonlyMap<string, Stream>
): { kind: StreamType; visibility: Visibility } {
  if (source.type === StreamTypes.THREAD && source.rootStreamId) {
    const root = byStreamId.get(source.rootStreamId)
    if (root) return { kind: root.type, visibility: root.visibility }
  }
  return { kind: source.type, visibility: source.visibility }
}

/**
 * Per-viewer recursive pointer hydration. Walks each pointer chain
 * level-by-level up to {@link MAX_HYDRATION_DEPTH}; at every level the
 * viewer's access is resolved via {@link listAccessibleStreamIds} (direct
 * member, public visibility, or thread inheriting from root) plus the
 * share-grant lookup (the viewer can also read a source iff a share with
 * that source exists in a target stream the viewer can read).
 *
 * Each level performs a fixed handful of batched queries (no per-ref DB
 * loops, INV-56): one `findByIdsInWorkspace`, one accessible-streams
 * lookup, one share-grant lookup. Author names and the private-placeholder
 * source-stream lookup are batched once at the end.
 *
 * Pointers collected at level `MAX_HYDRATION_DEPTH` are emitted as
 * `truncated` using the cached `streamId` from the parent's node attrs —
 * no extra DB hit. If the viewer doesn't have access there, clicking
 * through will 403 like any other deep link, which is fine; the cap is a
 * pathological-data guard, not a privacy guard.
 */
export async function hydrateSharedMessageIds(
  db: Querier,
  workspaceId: string,
  viewerId: string,
  sourceMessageIds: Iterable<string>
): Promise<Record<string, HydratedSharedMessage>> {
  const seedIds = Array.from(new Set(sourceMessageIds))
  if (seedIds.length === 0) return {}

  const result: Record<string, HydratedSharedMessage> = {}
  const visited = new Set<string>()
  const okMessages = new Map<string, Message>()
  // messageId → streamId of the source (for batched stream lookup at the end).
  const privateBuckets = new Map<string, string>()

  // Frontier holds (messageId → streamId-from-attrs); seed level has no
  // attrs streamId so we leave it empty — these get populated for nested
  // levels via `collectSharedMessageRefs`.
  let frontier = new Map<string, string>(seedIds.map((id) => [id, ""]))
  let depth = 0

  while (frontier.size > 0 && depth < MAX_HYDRATION_DEPTH) {
    const ids = [...frontier.keys()].filter((id) => !visited.has(id))
    if (ids.length === 0) break
    for (const id of ids) visited.add(id)

    const byId = await MessageRepository.findByIdsInWorkspace(db, workspaceId, ids)
    const fetchedStreamIds = [...byId.values()].map((m) => m.streamId)
    const [accessibleStreams, grantedSources] = await Promise.all([
      listAccessibleStreamIds(db, workspaceId, viewerId, fetchedStreamIds),
      SharedMessageRepository.listSourcesGrantedToViewer(db, workspaceId, viewerId, ids),
    ])

    const nextFrontier = new Map<string, string>()
    for (const id of ids) {
      const source = byId.get(id)
      if (!source) {
        result[id] = { state: "missing", messageId: id }
        continue
      }
      const hasAccess = accessibleStreams.has(source.streamId) || grantedSources.has(id)
      if (!hasAccess) {
        privateBuckets.set(id, source.streamId)
        continue
      }
      if (source.deletedAt) {
        result[id] = { state: "deleted", messageId: id, deletedAt: source.deletedAt }
        continue
      }
      okMessages.set(id, source)
      collectSharedMessageRefs(source.contentJson, nextFrontier)
    }

    frontier = nextFrontier
    depth++
  }

  // Anything still in frontier has been collected from depth=MAX-1's
  // accessible content but we won't recurse into it. Emit truncated using
  // the streamId cached on the share-node attrs — no extra DB call.
  for (const [id, streamId] of frontier) {
    if (visited.has(id) || result[id]) continue
    if (!streamId) continue
    result[id] = { state: "truncated", messageId: id, streamId }
  }

  if (privateBuckets.size > 0) {
    const directIds = [...new Set(privateBuckets.values())]
    const streams = await StreamRepository.findByIds(db, directIds)
    const byStreamId = new Map(streams.map((s) => [s.id, s]))
    const rootIds = [
      ...new Set(
        streams.flatMap((s) =>
          s.type === StreamTypes.THREAD && s.rootStreamId && !byStreamId.has(s.rootStreamId) ? [s.rootStreamId] : []
        )
      ),
    ]
    if (rootIds.length > 0) {
      const roots = await StreamRepository.findByIds(db, rootIds)
      for (const r of roots) byStreamId.set(r.id, r)
    }
    for (const [id, streamId] of privateBuckets) {
      const source = byStreamId.get(streamId)
      if (!source) {
        result[id] = { state: "missing", messageId: id }
        continue
      }
      const { kind, visibility } = resolveSourceForPrivatePlaceholder(source, byStreamId)
      result[id] = { state: "private", messageId: id, sourceStreamKind: kind, sourceVisibility: visibility }
    }
  }

  if (okMessages.size > 0) {
    const actorIds = new Set<string>()
    for (const msg of okMessages.values()) actorIds.add(msg.authorId)
    const authorNames = await resolveActorNames(db, workspaceId, actorIds)
    for (const [id, source] of okMessages) {
      result[id] = {
        state: "ok",
        messageId: source.id,
        streamId: source.streamId,
        authorId: source.authorId,
        authorType: source.authorType,
        authorName: authorNames.get(source.authorId) ?? null,
        contentJson: source.contentJson,
        contentMarkdown: source.contentMarkdown,
        editedAt: source.editedAt,
        createdAt: source.createdAt,
      }
    }
  }

  // Defensive backfill — every requested id should have a result by now;
  // anything left over (e.g. a seed id that hit no path above) is missing.
  for (const id of seedIds) {
    if (!result[id]) result[id] = { state: "missing", messageId: id }
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
  workspaceId: string,
  viewerId: string,
  messages: readonly Message[]
): Promise<Record<string, HydratedSharedMessage>> {
  const ids = new Set<string>()
  for (const msg of messages) {
    collectSharedMessageIds(msg.contentJson, ids)
  }
  return hydrateSharedMessageIds(db, workspaceId, viewerId, ids)
}
