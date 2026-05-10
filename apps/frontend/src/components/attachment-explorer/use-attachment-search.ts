import { useMemo } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { attachmentsApi, type AttachmentSearchItem, type AttachmentSearchRequest } from "@/api/attachments"
import type { ExplorerFilters } from "./use-explorer-url-state"

const PAGE_SIZE = 30

export const explorerKeys = {
  all: (workspaceId: string) => ["attachment-explorer", workspaceId] as const,
  search: (workspaceId: string, body: AttachmentSearchRequest) => ["attachment-explorer", workspaceId, body] as const,
}

function filtersToRequest(filters: ExplorerFilters): AttachmentSearchRequest {
  const body: AttachmentSearchRequest = { limit: PAGE_SIZE }
  if (filters.streamIds.length) body.streamIds = filters.streamIds
  if (filters.categories.length) body.categories = filters.categories
  if (filters.uploadedBy) body.uploadedBy = filters.uploadedBy
  if (filters.nameSubstring) body.nameSubstring = filters.nameSubstring
  if (filters.before) body.before = filters.before
  if (filters.after) body.after = filters.after

  const trimmed = filters.queryText.trim()
  if (trimmed) {
    const quoted = /^"(.+)"$/.exec(trimmed)
    if (quoted) {
      body.queryText = quoted[1]!
      body.exact = true
    } else {
      body.queryText = trimmed
    }
  }

  return body
}

export interface UseAttachmentSearchResult {
  items: AttachmentSearchItem[]
  isLoading: boolean
  isError: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean
  fetchNextPage: () => Promise<unknown>
  refetch: () => Promise<unknown>
}

export function useAttachmentSearch(
  workspaceId: string | undefined,
  filters: ExplorerFilters,
  options: { enabled?: boolean } = {}
): UseAttachmentSearchResult {
  const enabled = (options.enabled ?? true) && Boolean(workspaceId)
  const body = useMemo(() => filtersToRequest(filters), [filters])

  const query = useInfiniteQuery({
    queryKey: explorerKeys.search(workspaceId ?? "", body),
    enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const requestBody: AttachmentSearchRequest = { ...body }
      if (pageParam) requestBody.cursor = pageParam
      return attachmentsApi.search(workspaceId!, requestBody)
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  })

  const items = query.data?.pages.flatMap((page) => page.items) ?? []

  return {
    items,
    isLoading: query.isLoading,
    isError: query.isError,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: Boolean(query.hasNextPage),
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  }
}
