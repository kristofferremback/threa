import type { Querier } from "../../db"
import { Visibilities } from "@threa/types"
import { StreamRepository, type Stream } from "./repository"
import { StreamMemberRepository } from "./member-repository"

/**
 * Canonical "does this user have access to this stream?" check.
 *
 * Returns the stream when access is granted; `null` otherwise. Handles all
 * three cases callers usually get wrong when they reach for
 * `StreamMemberRepository.isMember` directly:
 *
 * 1. **Workspace boundary** — a stream belonging to another workspace is
 *    treated as inaccessible (INV-8), even when the caller's userId
 *    happens to be a member elsewhere.
 * 2. **Public channels** — public channels grant read access to every
 *    workspace member without requiring a `stream_members` row, so
 *    membership-only checks would falsely deny access.
 * 3. **Threads** — threads inherit access from their root stream's
 *    membership/visibility; checking membership on the thread itself is
 *    nearly always wrong.
 *
 * Use this from any feature that needs to gate on stream access. Inlining
 * `StreamMemberRepository.isMember` plus visibility logic is a recurring
 * footgun (membership ≠ access) — route everything through here so the
 * three cases above stay consistent.
 *
 * Takes a `Querier` so it composes with existing transactions (`withClient`
 * / `withTransaction` blocks) without acquiring an extra connection. The
 * `StreamService.checkAccess` wrapper is a thin `withClient(...)` around
 * this for callers that don't have a Querier in scope.
 */
export async function checkStreamAccess(
  db: Querier,
  streamId: string,
  workspaceId: string,
  userId: string
): Promise<Stream | null> {
  const stream = await StreamRepository.findById(db, streamId)
  if (!stream || stream.workspaceId !== workspaceId) return null

  // Threads inherit access from their root: the thread itself usually has
  // no `stream_members` row, so a membership check on the thread id would
  // always 403 even for users with full access to the surrounding channel.
  if (stream.rootStreamId) {
    const rootStream = await StreamRepository.findById(db, stream.rootStreamId)
    if (!rootStream) return null

    if (rootStream.visibility !== Visibilities.PUBLIC) {
      const isRootMember = await StreamMemberRepository.isMember(db, stream.rootStreamId, userId)
      if (!isRootMember) return null
    }
    return stream
  }

  if (stream.visibility !== Visibilities.PUBLIC) {
    const isMember = await StreamMemberRepository.isMember(db, streamId, userId)
    if (!isMember) return null
  }
  return stream
}
