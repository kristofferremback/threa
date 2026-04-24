import type { Querier } from "../../db"
import { Visibilities } from "@threa/types"
import { StreamRepository } from "./repository"
import { StreamMemberRepository } from "./member-repository"

/**
 * Pure, Querier-based read-access check used by callers that need to gate
 * operations on a source stream inside a shared transaction (e.g. the sharing
 * service). Mirrors `StreamService.checkAccess` but threads the caller's
 * client so the check stays on the same transactional view.
 *
 * Returns true when `userId` can read `streamId` in `workspaceId`:
 *   - stream must exist and belong to `workspaceId`
 *   - threads inherit access from their root stream (visibility + membership)
 *   - public streams are readable by any workspace member
 *   - otherwise the user must be a member of the stream (or its root)
 */
export async function canReadStream(
  db: Querier,
  workspaceId: string,
  streamId: string,
  userId: string
): Promise<boolean> {
  const stream = await StreamRepository.findById(db, streamId)
  if (!stream || stream.workspaceId !== workspaceId) return false

  if (stream.rootStreamId) {
    const root = await StreamRepository.findById(db, stream.rootStreamId)
    if (!root) return false
    if (root.visibility === Visibilities.PUBLIC) return true
    return StreamMemberRepository.isMember(db, stream.rootStreamId, userId)
  }

  if (stream.visibility === Visibilities.PUBLIC) return true
  return StreamMemberRepository.isMember(db, streamId, userId)
}
