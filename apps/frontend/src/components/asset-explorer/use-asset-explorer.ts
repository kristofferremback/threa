import { useInfiniteQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { searchAssets, type AssetSearchRequest, type AssetSearchResponse } from "@/api"
import type { AssetKind, AssetSearchScope, ExtractionContentType } from "@threa/types"

export const assetExplorerKeys = {
  all: ["asset-explorer"] as const,
  search: (workspaceId: string, scopeKey: string, body: SerializableSearchBody) =>
    [...assetExplorerKeys.all, "search", workspaceId, scopeKey, body] as const,
}

export interface AssetExplorerFilters {
  query: string
  exact: boolean
  uploadedBy: string | null
  mimeGroups: AssetKind[]
  contentTypes: ExtractionContentType[]
  before: string | null
  after: string | null
}

interface SerializableSearchBody {
  query: string
  exact: boolean
  uploadedBy: string | null
  mimeGroups: AssetKind[]
  contentTypes: ExtractionContentType[]
  before: string | null
  after: string | null
}

const PAGE_SIZE = 30

export function useAssetExplorer(opts: {
  workspaceId: string
  scope: AssetSearchScope
  filters: AssetExplorerFilters
  enabled: boolean
}) {
  const { workspaceId, scope, filters, enabled } = opts

  // Stable cache key — scope identity + the serializable filter state. Distinct
  // searches share no cache (key includes filters), but pagination of the same
  // search shares a single key (and `pageParam` carries the cursor).
  const scopeKey = scope.type === "stream" ? `stream:${scope.streamId}` : "unknown"
  const body: SerializableSearchBody = useMemo(
    () => ({
      query: filters.query,
      exact: filters.exact,
      uploadedBy: filters.uploadedBy,
      mimeGroups: filters.mimeGroups,
      contentTypes: filters.contentTypes,
      before: filters.before,
      after: filters.after,
    }),
    [filters]
  )

  return useInfiniteQuery<AssetSearchResponse, Error>({
    queryKey: assetExplorerKeys.search(workspaceId, scopeKey, body),
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const req: AssetSearchRequest = {
        scope,
        query: body.query || undefined,
        exact: body.exact || undefined,
        cursor: typeof pageParam === "string" ? pageParam : undefined,
        limit: PAGE_SIZE,
        filters: {
          from: body.uploadedBy ?? undefined,
          mimeGroups: body.mimeGroups.length > 0 ? body.mimeGroups : undefined,
          contentTypes: body.contentTypes.length > 0 ? body.contentTypes : undefined,
          before: body.before ?? undefined,
          after: body.after ?? undefined,
        },
      }
      return searchAssets(workspaceId, req)
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  })
}

export const initialAssetFilters: AssetExplorerFilters = {
  query: "",
  exact: false,
  uploadedBy: null,
  mimeGroups: [],
  contentTypes: [],
  before: null,
  after: null,
}
