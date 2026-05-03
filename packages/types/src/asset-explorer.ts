/**
 * Asset explorer API contracts.
 *
 * The asset explorer surface is intentionally separate from the attachment
 * upload/lifecycle API: attachments are a primitive (write/own), while the
 * explorer is a read-side projection that joins attachments with their
 * extractions to power browse + search.
 *
 * The {@link AssetSearchScope} discriminator is forward-compatible: today the
 * only variant is `stream`, but the same wire shape supports a future
 * `workspace` (or `stream-tree`) variant without a breaking change. Backend
 * scope resolvers convert the variant into a list of accessible stream IDs;
 * everything below that layer is scope-agnostic.
 */

import type { ExtractionContentType, ProcessingStatus } from "./constants"

/**
 * Coarse buckets the frontend uses to render type filters and pick icons.
 * Stable wire enum — backend maps mime types to one of these via a single
 * helper so the mapping stays consistent across browse/search results.
 */
export const ASSET_KINDS = ["image", "video", "pdf", "document", "spreadsheet", "text", "other"] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export const AssetKinds = {
  IMAGE: "image",
  VIDEO: "video",
  PDF: "pdf",
  DOCUMENT: "document",
  SPREADSHEET: "spreadsheet",
  TEXT: "text",
  OTHER: "other",
} as const satisfies Record<string, AssetKind>

/**
 * Where to search. Forward-compatible: workspace-wide search lands as a
 * second variant, no wire-shape change required.
 */
export type AssetSearchScope = { type: "stream"; streamId: string }

export interface AssetSearchFilters {
  /** Single uploader user id. */
  from?: string
  /** Coarse kind filter (OR within the array). */
  mimeGroups?: AssetKind[]
  /** Extraction content-type filter (OR within the array). */
  contentTypes?: ExtractionContentType[]
  /** Exclusive upper bound. */
  before?: string
  /** Inclusive lower bound. */
  after?: string
}

export interface AssetSearchRequest {
  /** Free-text query. Empty/missing → recent-first browse. */
  query?: string
  /**
   * If true, use case-insensitive substring matching on filename + extracted
   * content (mirrors `/search`'s `exact` toggle).
   */
  exact?: boolean
  scope: AssetSearchScope
  filters?: AssetSearchFilters
  /** Opaque cursor returned by a previous response. */
  cursor?: string
  /** Max results (1-100). */
  limit?: number
}

export interface AssetSearchResult {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  /** ISO timestamp. */
  createdAt: string
  uploadedBy: string | null
  streamId: string | null
  messageId: string | null
  processingStatus: ProcessingStatus
  /** Coarse bucket — frontend uses this for icon + type-filter UI. */
  kind: AssetKind
  /**
   * Whether a thumbnail variant is available via
   * `GET /attachments/:id/url?variant=thumbnail`. Images are always self-thumbnailable;
   * videos require a completed transcode.
   */
  hasThumbnail: boolean
  /**
   * Optional preview snippet. Today this surfaces the extraction summary when
   * available; future iterations can add highlight snippets on query matches.
   */
  preview: string | null
  /**
   * Relevance score for the request. 0 in browse mode (recency-ordered).
   */
  rank: number
}

export interface AssetSearchResponse {
  results: AssetSearchResult[]
  nextCursor: string | null
}
