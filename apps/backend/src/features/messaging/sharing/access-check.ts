import type { Querier } from "../../../db"
import { sql } from "../../../db"

/**
 * Minimal structural shape needed to answer the source-visibility check.
 * Defined here so the sharing sub-feature does not import from the streams
 * feature — satisfies INV-52 and breaks the barrel cycle that arises
 * because streams/handlers.ts imports hydration helpers from the messaging
 * barrel. `parent_stream_id` / ancestry live in the DB and are answered by
 * the injected {@link IsAncestorStream} callback, not by walking app-side.
 */
export interface SharingStream {
  id: string
  workspaceId: string
  visibility: string
}

export type FindStreamForSharing = (db: Querier, id: string) => Promise<SharingStream | null>

/**
 * Returns true when `ancestorCandidateId` is `streamId` itself or appears
 * anywhere on its parent chain. Implemented in the streams repository as a
 * single recursive CTE; injected here as a callback so the sharing sub-feature
 * stays free of a direct `StreamRepository` import (INV-52).
 */
export type IsAncestorStream = (db: Querier, ancestorCandidateId: string, streamId: string) => Promise<boolean>

export interface PrivacyBoundaryResult {
  /** True when target members exist who cannot already see the source stream. */
  triggered: boolean
  /** Count of target members who would gain implicit read via the share. */
  exposedUserCount: number
}

/**
 * Checks whether sharing from `sourceStreamId` into `targetStreamId` would
 * expose the source to target members who don't already have access. The
 * warning triggers only when the source is private AND at least one target
 * member isn't in the source's stream_members set (D2).
 *
 * Share-to-parent short-circuits: if `targetStreamId` is an ancestor of
 * `sourceStreamId`, the parent audience already contains the thread's
 * audience by construction, so nothing new is revealed.
 */
export async function crossesPrivacyBoundary(
  db: Querier,
  findStream: FindStreamForSharing,
  isAncestor: IsAncestorStream,
  sourceStreamId: string,
  targetStreamId: string
): Promise<PrivacyBoundaryResult> {
  if (sourceStreamId === targetStreamId) {
    return { triggered: false, exposedUserCount: 0 }
  }

  if (await isAncestor(db, targetStreamId, sourceStreamId)) {
    return { triggered: false, exposedUserCount: 0 }
  }

  const source = await findStream(db, sourceStreamId)
  if (!source || source.visibility !== "private") {
    return { triggered: false, exposedUserCount: 0 }
  }

  const result = await db.query<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM stream_members tgt
    WHERE tgt.stream_id = ${targetStreamId}
      AND NOT EXISTS (
        SELECT 1 FROM stream_members src
        WHERE src.stream_id = ${sourceStreamId}
          AND src.user_id = tgt.user_id
      )
  `)
  const exposedUserCount = Number(result.rows[0]?.count ?? "0")
  return { triggered: exposedUserCount > 0, exposedUserCount }
}
