import type { Pool } from "pg"
import type { AssetSearchScope } from "@threa/types"
import { checkStreamAccess } from "../streams"
import { SearchRepository } from "../search"

/**
 * Resolve an `AssetSearchScope` into the list of stream IDs the requester
 * can read inside that scope. Returns `null` when the scope itself is
 * inaccessible (e.g. the stream is in another workspace, or the viewer
 * isn't a member of a private stream); the handler turns this into 404 so
 * we don't leak existence.
 *
 * Today only `stream` is implemented; the discriminator + this helper are
 * the seam where workspace-wide scope will land — same call site, new branch.
 */
export async function resolveAssetSearchScope(
  pool: Pool,
  workspaceId: string,
  userId: string,
  scope: AssetSearchScope
): Promise<string[] | null> {
  switch (scope.type) {
    case "stream": {
      const stream = await checkStreamAccess(pool, scope.streamId, workspaceId, userId)
      if (!stream) return null

      // Include the stream itself plus every thread that hangs off it. Threads
      // inherit access from their root, and `attachments.stream_id` is the
      // thread id when an attachment was uploaded inside a thread — without
      // expanding here we'd silently miss those.
      return SearchRepository.getStreamWithThreads(pool, scope.streamId)
    }
  }
}
