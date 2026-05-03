import { AssetKinds, type AssetKind } from "@threa/types"

/**
 * Map a mime type (and optional filename) to the coarse {@link AssetKind}
 * bucket the explorer UI uses. Mirrors the granularity of the
 * `is*Attachment` helpers in `features/attachments/*` but folds them into a
 * single classification so handler/repo code doesn't have to OR several
 * predicates together.
 *
 * The frontend uses the same bucket names for filter chips and icon
 * selection — keep this list in sync with `AssetKinds`.
 */
export function classifyAssetKind(mimeType: string, filename?: string): AssetKind {
  if (mimeType.startsWith("image/")) return AssetKinds.IMAGE
  if (mimeType.startsWith("video/")) return AssetKinds.VIDEO
  if (mimeType === "application/pdf") return AssetKinds.PDF

  if (
    mimeType === "application/msword" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/vnd.oasis.opendocument.text"
  ) {
    return AssetKinds.DOCUMENT
  }

  if (
    mimeType === "application/vnd.ms-excel" ||
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.oasis.opendocument.spreadsheet" ||
    mimeType === "text/csv"
  ) {
    return AssetKinds.SPREADSHEET
  }

  if (mimeType.startsWith("text/") || mimeType === "application/json") return AssetKinds.TEXT

  // application/octet-stream with a known video extension is treated as video
  // (matches `isVideoAttachment` behavior in the attachments feature).
  if (mimeType === "application/octet-stream" && filename) {
    const lower = filename.toLowerCase()
    if (lower.endsWith(".mp4") || lower.endsWith(".mov") || lower.endsWith(".webm") || lower.endsWith(".mkv")) {
      return AssetKinds.VIDEO
    }
  }

  return AssetKinds.OTHER
}

/**
 * Build a SQL fragment-friendly list of mime patterns (LIKE prefixes + exact
 * matches) matching the requested kinds. Returns two arrays so the caller can
 * pass them to a single SQL clause: `mime_type LIKE ANY(prefixes) OR mime_type = ANY(exact)`.
 */
export function mimePatternsForKinds(kinds: readonly AssetKind[]): { prefixes: string[]; exact: string[] } {
  const prefixes = new Set<string>()
  const exact = new Set<string>()

  for (const kind of kinds) {
    switch (kind) {
      case AssetKinds.IMAGE:
        prefixes.add("image/%")
        break
      case AssetKinds.VIDEO:
        prefixes.add("video/%")
        // octet-stream + video extension is handled in the SQL via filename ILIKE
        break
      case AssetKinds.PDF:
        exact.add("application/pdf")
        break
      case AssetKinds.DOCUMENT:
        exact.add("application/msword")
        exact.add("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        exact.add("application/vnd.oasis.opendocument.text")
        break
      case AssetKinds.SPREADSHEET:
        exact.add("application/vnd.ms-excel")
        exact.add("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        exact.add("application/vnd.oasis.opendocument.spreadsheet")
        exact.add("text/csv")
        break
      case AssetKinds.TEXT:
        prefixes.add("text/%")
        exact.add("application/json")
        break
      case AssetKinds.OTHER:
        // "Other" is the residual bucket; it can't be expressed as a simple
        // pattern set without listing every other mime, so we encode it as
        // NOT-IN-the-others in the SQL builder rather than here.
        break
    }
  }

  return { prefixes: [...prefixes], exact: [...exact] }
}
