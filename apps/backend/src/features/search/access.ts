import type { Querier } from "../../db"
import { SearchRepository } from "./repository"
import type { SearchFilters } from "./service"

/**
 * Resolve accessible stream IDs for a user session.
 * Extracted from SearchService so callers can resolve access
 * before passing to the auth-agnostic SearchService.search().
 */
export async function resolveUserAccessibleStreamIds(
  db: Querier,
  workspaceId: string,
  userId: string,
  filters: SearchFilters
): Promise<string[]> {
  return SearchRepository.getAccessibleStreamsWithMembers(db, {
    workspaceId,
    userId,
    userIds: filters.userIds,
    streamTypes: filters.streamTypes,
    archiveStatus: filters.archiveStatus,
  })
}
