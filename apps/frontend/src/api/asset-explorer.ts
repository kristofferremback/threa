import api from "./client"
import type { AssetSearchRequest, AssetSearchResponse } from "@threa/types"

export type { AssetSearchRequest, AssetSearchResponse, AssetSearchResult } from "@threa/types"

/**
 * Search/browse assets the requester can access. Stream-scoped today; the
 * `scope` discriminator is forward-compatible with workspace-wide search.
 */
export async function searchAssets(workspaceId: string, request: AssetSearchRequest): Promise<AssetSearchResponse> {
  return api.post<AssetSearchResponse>(`/api/workspaces/${workspaceId}/assets/search`, request)
}
