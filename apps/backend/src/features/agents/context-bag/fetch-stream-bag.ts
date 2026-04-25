import type { Querier } from "../../../db"
import { ContextRefKinds, type ContextIntent } from "@threa/types"
import { HttpError } from "../../../lib/errors"
import { StreamRepository, checkStreamAccess } from "../../streams"
import { MessageRepository } from "../../messaging"
import { ContextBagRepository } from "./repository"
import { getResolver } from "./registry"

export interface ContextRefSource {
  streamId: string
  displayName: string | null
  slug: string | null
  type: string
  itemCount: number
}

export interface EnrichedContextRef {
  kind: typeof ContextRefKinds.THREAD
  streamId: string
  fromMessageId: string | null
  toMessageId: string | null
  /** Cosmetic deep-link anchor; resolver ignores it. */
  originMessageId: string | null
  source: ContextRefSource
}

export interface StreamContextBagResponse {
  bag: {
    id: string
    intent: ContextIntent
  } | null
  refs: EnrichedContextRef[]
}

export interface FetchStreamBagOptions {
  /**
   * Skip the per-stream access check. Set to true when the caller has
   * already validated stream access (e.g. the stream-bootstrap handler runs
   * `validateStreamAccess` before reaching this code) — avoids a duplicate
   * lookup.
   */
  skipAccessCheck?: boolean
}

/**
 * Fetch the persisted ContextBag for a stream with each ref enriched with
 * source-stream metadata. Shared between:
 *
 * - `GET /api/workspaces/:ws/streams/:id/context-bag` (the standalone HTTP
 *   handler, used by composer chip lookups)
 * - `GET /api/workspaces/:ws/streams/:id/bootstrap` (folds the bag into the
 *   stream bootstrap so the timeline message badge renders synchronously
 *   from cached data, no second fetch, no layout shift on first render)
 *
 * Returns `{bag: null, refs: []}` for streams without an attached bag.
 *
 * Access policy (INV-8):
 * - Caller must have stream access — verified via `checkStreamAccess`
 *   unless `skipAccessCheck` is set (bootstrap caller has already done it).
 * - Per-ref read access is always re-verified via `resolver.assertAccess`.
 *   A user who lost access to a source thread sees the bag minus that ref.
 */
export async function fetchStreamBag(
  db: Querier,
  params: {
    workspaceId: string
    streamId: string
    userId: string
  },
  options: FetchStreamBagOptions = {}
): Promise<StreamContextBagResponse> {
  const { workspaceId, streamId, userId } = params

  // Use the canonical access check rather than membership directly:
  // public channels grant read without `stream_members` rows, and threads
  // inherit access from their root stream — both cases that
  // `StreamMemberRepository.isMember` gets wrong. Bootstrap callers pass
  // `skipAccessCheck: true` because `validateStreamAccess` already ran.
  if (!options.skipAccessCheck) {
    const stream = await checkStreamAccess(db, streamId, workspaceId, userId)
    if (!stream) {
      throw new HttpError("No access to stream", { status: 403, code: "STREAM_FORBIDDEN" })
    }
  }

  const bag = await ContextBagRepository.findByStream(db, workspaceId, streamId)
  if (!bag) {
    return { bag: null, refs: [] }
  }

  const enriched: EnrichedContextRef[] = []
  for (const ref of bag.refs) {
    const resolver = getResolver(ref.kind)
    await resolver.assertAccess(db, ref, userId, workspaceId)

    const sourceStream = await StreamRepository.findById(db, ref.streamId)
    if (!sourceStream) continue

    const itemCount = await MessageRepository.countByStream(db, ref.streamId)

    enriched.push({
      kind: ContextRefKinds.THREAD,
      streamId: ref.streamId,
      fromMessageId: ref.fromMessageId ?? null,
      toMessageId: ref.toMessageId ?? null,
      originMessageId: ref.originMessageId ?? null,
      source: {
        streamId: sourceStream.id,
        displayName: sourceStream.displayName ?? null,
        slug: sourceStream.slug ?? null,
        type: sourceStream.type,
        itemCount,
      },
    })
  }

  return {
    bag: { id: bag.id, intent: bag.intent },
    refs: enriched,
  }
}
