import type { Querier } from "../../../db"
import { sql } from "../../../db"

/**
 * Minimal structural shape needed to answer ancestor / privacy checks.
 * Defined here so the sharing sub-feature does not import from the streams
 * feature — satisfies INV-52 and breaks the barrel cycle that arises
 * because streams/handlers.ts imports hydration helpers from the messaging
 * barrel.
 */
export interface SharingStream {
  id: string
  workspaceId: string
  visibility: string
  parentStreamId: string | null
}

export type FindStreamForSharing = (db: Querier, id: string) => Promise<SharingStream | null>

/**
 * Walk the parentStreamId chain starting at `streamId` and return true if
 * `ancestorCandidateId` appears anywhere on the path (including the start
 * itself). Used to treat share-to-parent as a safe path without privacy
 * prompt per plan F1/D2 — a thread's parent audience is by construction a
 * superset of the thread's, so nothing new is revealed.
 *
 * Bounded at `MAX_ANCESTOR_DEPTH` hops to guard against pathological data.
 */
const MAX_ANCESTOR_DEPTH = 8

export async function isAncestorStream(
  db: Querier,
  findStream: FindStreamForSharing,
  ancestorCandidateId: string,
  streamId: string
): Promise<boolean> {
  if (ancestorCandidateId === streamId) return true
  let current: SharingStream | null = await findStream(db, streamId)
  for (let i = 0; i < MAX_ANCESTOR_DEPTH && current?.parentStreamId; i++) {
    if (current.parentStreamId === ancestorCandidateId) return true
    current = await findStream(db, current.parentStreamId)
  }
  return false
}

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
  sourceStreamId: string,
  targetStreamId: string
): Promise<PrivacyBoundaryResult> {
  if (sourceStreamId === targetStreamId) {
    return { triggered: false, exposedUserCount: 0 }
  }

  if (await isAncestorStream(db, findStream, targetStreamId, sourceStreamId)) {
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
