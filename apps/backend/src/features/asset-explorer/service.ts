import type { Pool } from "pg"
import {
  AssetKinds,
  type AssetKind,
  type AssetSearchResult,
  type AssetSearchScope,
  type ExtractionContentType,
  type ProcessingStatus,
} from "@threa/types"
import { AssetExplorerRepository, type AssetSearchRepoResult } from "./repository"
import { decodeCursor, encodeCursor } from "./cursor"
import { classifyAssetKind } from "./mime-groups"

/**
 * Caller-resolved access boundary. The handler resolves what the requester
 * can see (via existing stream-access helpers) and passes it here so the
 * service stays auth-agnostic — same pattern as `SearchService`.
 */
export interface AssetSearchPermissions {
  accessibleStreamIds: string[]
}

export interface AssetSearchParams {
  workspaceId: string
  permissions: AssetSearchPermissions
  scope: AssetSearchScope
  query: string
  exact: boolean
  filters: {
    uploadedBy?: string
    mimeKinds?: AssetKind[]
    contentTypes?: ExtractionContentType[]
    before?: Date
    after?: Date
  }
  cursor: string | null
  limit: number
}

export interface AssetSearchOutput {
  results: AssetSearchResult[]
  nextCursor: string | null
}

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

export class AssetExplorerService {
  constructor(private pool: Pool) {}

  async search(params: AssetSearchParams): Promise<AssetSearchOutput> {
    const limit = clampLimit(params.limit ?? DEFAULT_LIMIT)
    const accessible = params.permissions.accessibleStreamIds
    if (accessible.length === 0) return { results: [], nextCursor: null }

    const trimmedQuery = params.query.trim()
    const hasQuery = trimmedQuery.length > 0
    const decoded = params.cursor ? decodeCursor(params.cursor) : null

    // Browse mode → keyset on (created_at, id). Search mode → numeric offset
    // (rank order is fragile under tie-breaking and float precision). The
    // wire-level cursor is opaque so this strategy can change later without
    // a contract break. Repository fetches `limit + 1` so we can detect the
    // presence of another page without a COUNT.
    const pagination = hasQuery
      ? ({
          kind: "offset" as const,
          offset: decoded?.kind === "offset" ? decoded.offset : 0,
          limit: limit + 1,
        } as const)
      : ({
          kind: "time" as const,
          before: decoded?.kind === "time" ? { createdAt: new Date(decoded.createdAt), id: decoded.id } : null,
          limit: limit + 1,
        } as const)

    const rows = await AssetExplorerRepository.search(this.pool, {
      streamIds: accessible,
      query: trimmedQuery,
      exact: params.exact,
      filters: params.filters,
      pagination,
    })

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    return {
      results: page.map(toWireResult),
      nextCursor: hasMore ? buildNextCursor(pagination, page) : null,
    }
  }
}

function buildNextCursor(
  pagination: { kind: "time" } | { kind: "offset"; offset: number },
  page: AssetSearchRepoResult[]
): string {
  if (pagination.kind === "time") {
    const last = page[page.length - 1]!
    return encodeCursor({ kind: "time", createdAt: last.createdAt.toISOString(), id: last.id })
  }
  return encodeCursor({ kind: "offset", offset: pagination.offset + page.length })
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.floor(limit))
}

function toWireResult(row: AssetSearchRepoResult): AssetSearchResult {
  const kind = classifyAssetKind(row.mimeType, row.filename)
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
    uploadedBy: row.uploadedBy,
    streamId: row.streamId,
    messageId: row.messageId,
    processingStatus: row.processingStatus as ProcessingStatus,
    kind,
    hasThumbnail: hasThumbnail(kind, row),
    preview: row.extractionSummary,
    rank: row.rank,
  }
}

function hasThumbnail(kind: AssetKind, row: AssetSearchRepoResult): boolean {
  if (kind === AssetKinds.IMAGE) return true
  if (kind === AssetKinds.VIDEO) return row.hasVideoThumbnail
  return false
}
