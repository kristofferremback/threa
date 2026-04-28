import { sql, type Querier } from "../../db"
import {
  AttachmentSafetyStatuses,
  AssetKinds,
  type AssetKind,
  type ExtractionContentType,
  type ProcessingStatus,
} from "@threa/types"
import { mimePatternsForKinds } from "./mime-groups"

/**
 * Internal row shape returned from the explorer SQL — flattens the
 * attachment ⨝ extraction join + the video transcode lookup into a single
 * row per asset so the service layer doesn't have to do a second pass.
 */
interface AssetSearchRow {
  id: string
  filename: string
  mime_type: string
  size_bytes: string
  created_at: Date
  uploaded_by: string | null
  stream_id: string | null
  message_id: string | null
  processing_status: string
  extraction_summary: string | null
  has_video_thumbnail: boolean
  rank: number
}

export interface AssetSearchRepoResult {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  createdAt: Date
  uploadedBy: string | null
  streamId: string | null
  messageId: string | null
  processingStatus: ProcessingStatus
  extractionSummary: string | null
  hasVideoThumbnail: boolean
  rank: number
}

export interface AssetSearchRepoParams {
  /**
   * Streams the caller has resolved as accessible. Empty list short-circuits
   * to an empty result.
   */
  streamIds: string[]
  /** Free-text query. Empty string ⇒ browse mode (recency-ordered). */
  query: string
  /** ILIKE substring matching on filename + extraction (case-insensitive). */
  exact: boolean
  filters: {
    uploadedBy?: string
    mimeKinds?: AssetKind[]
    contentTypes?: ExtractionContentType[]
    before?: Date
    after?: Date
  }
  pagination:
    | { kind: "time"; before: { createdAt: Date; id: string } | null; limit: number }
    | { kind: "offset"; offset: number; limit: number }
}

function mapRow(row: AssetSearchRow): AssetSearchRepoResult {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at,
    uploadedBy: row.uploaded_by,
    streamId: row.stream_id,
    messageId: row.message_id,
    processingStatus: row.processing_status as ProcessingStatus,
    extractionSummary: row.extraction_summary,
    hasVideoThumbnail: row.has_video_thumbnail,
    rank: row.rank,
  }
}

/**
 * Build the LIKE-pattern + exact-match clause for the configured mime kinds.
 * Returns SQL fragments + parameter values; relies on the `OTHER` bucket being
 * encoded as the residual (NOT IN the union of the other kinds).
 */
function buildMimeKindClause(kinds: readonly AssetKind[] | undefined) {
  if (!kinds || kinds.length === 0) return null

  const includesOther = kinds.includes(AssetKinds.OTHER)
  const otherKinds = kinds.filter((k) => k !== AssetKinds.OTHER)
  const { prefixes, exact } = mimePatternsForKinds(otherKinds)

  // The residual "other" bucket = everything not matching the known patterns.
  // We compute the residual by listing every non-other kind here so the
  // WHERE clause stays a single OR group.
  const residualPrefixes = includesOther
    ? mimePatternsForKinds([AssetKinds.IMAGE, AssetKinds.VIDEO, AssetKinds.TEXT]).prefixes
    : []
  const residualExact = includesOther
    ? mimePatternsForKinds([AssetKinds.PDF, AssetKinds.DOCUMENT, AssetKinds.SPREADSHEET, AssetKinds.TEXT]).exact
    : []

  return { prefixes, exact, includesOther, residualPrefixes, residualExact }
}

export const AssetExplorerRepository = {
  /**
   * Search/browse assets across the caller-resolved streams. The single SQL
   * query handles three modes:
   *
   *   1. Browse (empty query): order by `(created_at DESC, id DESC)`,
   *      keyset-paginated.
   *   2. Exact search: ILIKE on filename + extraction, recency-ordered,
   *      offset-paginated.
   *   3. Full-text search (default): combine `to_tsvector` rank with a
   *      filename-ILIKE boost so substring matches on filenames outrank
   *      content matches (per the explorer spec). Offset-paginated.
   *
   * The same query also computes `has_video_thumbnail` via a LEFT JOIN on
   * `video_transcode_jobs` so the frontend doesn't need a second round-trip
   * to decide whether to fetch a thumbnail variant.
   */
  async search(db: Querier, params: AssetSearchRepoParams): Promise<AssetSearchRepoResult[]> {
    const { streamIds, query, exact, filters, pagination } = params
    if (streamIds.length === 0) return []

    const trimmedQuery = query.trim()
    const hasQuery = trimmedQuery.length > 0
    const ilikePattern = hasQuery ? `%${trimmedQuery.replace(/[%_\\]/g, "\\$&")}%` : ""

    const mime = buildMimeKindClause(filters.mimeKinds)
    const hasMimeFilter = mime !== null
    const hasUploaderFilter = filters.uploadedBy !== undefined
    const hasBefore = filters.before !== undefined
    const hasAfter = filters.after !== undefined
    const hasContentTypeFilter = (filters.contentTypes?.length ?? 0) > 0

    const limit = pagination.limit
    const offset = pagination.kind === "offset" ? pagination.offset : 0
    const cursorCreatedAt = pagination.kind === "time" && pagination.before ? pagination.before.createdAt : null
    const cursorId = pagination.kind === "time" && pagination.before ? pagination.before.id : ""
    const hasTimeCursor = pagination.kind === "time" && pagination.before !== null

    // Rank expression varies by mode. We compute it inline so the ORDER BY
    // clause can reference the same value without a subquery wrapper.
    //
    //   - Browse: rank = 0 (created_at carries the order).
    //   - Exact: rank = 0 (recency carries the order).
    //   - Full-text: ts_rank on the joined search vectors + filename-ILIKE
    //     boost (1.0 added when the substring appears in the filename so
    //     filename matches always rank above pure content matches).
    const rows = await db.query<AssetSearchRow>(sql`
      SELECT
        a.id,
        a.filename,
        a.mime_type,
        a.size_bytes,
        a.created_at,
        a.uploaded_by,
        a.stream_id,
        a.message_id,
        a.processing_status,
        e.summary AS extraction_summary,
        (vtj.thumbnail_storage_path IS NOT NULL) AS has_video_thumbnail,
        CASE
          WHEN ${!hasQuery} OR ${exact} THEN 0
          ELSE
            COALESCE(ts_rank(a.search_vector, websearch_to_tsquery('english', ${trimmedQuery})), 0)
            + COALESCE(ts_rank(e.search_vector, websearch_to_tsquery('english', ${trimmedQuery})), 0) * 0.5
            + CASE WHEN a.filename ILIKE ${ilikePattern} THEN 1.0 ELSE 0 END
        END AS rank
      FROM attachments a
      LEFT JOIN attachment_extractions e ON e.attachment_id = a.id
      LEFT JOIN video_transcode_jobs vtj
        ON vtj.attachment_id = a.id AND vtj.status = 'completed'
      WHERE a.stream_id = ANY(${streamIds})
        AND a.message_id IS NOT NULL
        AND a.safety_status = ${AttachmentSafetyStatuses.CLEAN}
        AND (${!hasQuery} OR ${exact === false} OR (
          a.filename ILIKE ${ilikePattern}
          OR e.summary ILIKE ${ilikePattern}
          OR e.full_text ILIKE ${ilikePattern}
        ))
        AND (${!hasQuery} OR ${exact === true} OR (
          a.search_vector @@ websearch_to_tsquery('english', ${trimmedQuery})
          OR e.search_vector @@ websearch_to_tsquery('english', ${trimmedQuery})
          OR a.filename ILIKE ${ilikePattern}
        ))
        AND (${!hasUploaderFilter} OR a.uploaded_by = ${filters.uploadedBy ?? ""})
        AND (${!hasBefore} OR a.created_at < ${filters.before ?? new Date()})
        AND (${!hasAfter} OR a.created_at >= ${filters.after ?? new Date(0)})
        AND (${!hasContentTypeFilter} OR e.content_type = ANY(${filters.contentTypes ?? []}))
        AND (
          ${!hasMimeFilter}
          OR a.mime_type LIKE ANY(${mime?.prefixes ?? []})
          OR a.mime_type = ANY(${mime?.exact ?? []})
          OR (
            ${mime?.includesOther ?? false}
            AND NOT (
              a.mime_type LIKE ANY(${mime?.residualPrefixes ?? []})
              OR a.mime_type = ANY(${mime?.residualExact ?? []})
            )
          )
        )
        AND (
          ${!hasTimeCursor}
          OR a.created_at < ${cursorCreatedAt ?? new Date()}
          OR (a.created_at = ${cursorCreatedAt ?? new Date()} AND a.id < ${cursorId})
        )
      ORDER BY
        CASE WHEN ${!hasQuery} OR ${exact} THEN 0 ELSE 1 END DESC,
        CASE
          WHEN ${!hasQuery} OR ${exact} THEN 0
          ELSE
            COALESCE(ts_rank(a.search_vector, websearch_to_tsquery('english', ${trimmedQuery})), 0)
            + COALESCE(ts_rank(e.search_vector, websearch_to_tsquery('english', ${trimmedQuery})), 0) * 0.5
            + CASE WHEN a.filename ILIKE ${ilikePattern} THEN 1.0 ELSE 0 END
        END DESC,
        a.created_at DESC,
        a.id DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `)

    return rows.rows.map(mapRow)
  },
}
