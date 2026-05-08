/**
 * Shared attachment category definitions.
 *
 * Maps the open-ended `mime_type` column on attachments to a small,
 * user-meaningful set of buckets. Used by:
 *   - the backend `attachments.search` repo to translate a `type:image,pdf`
 *     filter into a list of mime prefixes
 *   - the frontend explorer to render category icons / accent colors and
 *     to expose `type:` chips with stable labels
 *
 * The mapping is intentionally coarse — Office variants and OpenDocument
 * variants collapse into one category each. Anything we don't recognise
 * falls into "other".
 */

export const ATTACHMENT_CATEGORIES = [
  "image",
  "video",
  "audio",
  "pdf",
  "doc",
  "sheet",
  "slide",
  "code",
  "archive",
  "other",
] as const

export type AttachmentCategory = (typeof ATTACHMENT_CATEGORIES)[number]

export const AttachmentCategories = {
  IMAGE: "image",
  VIDEO: "video",
  AUDIO: "audio",
  PDF: "pdf",
  DOC: "doc",
  SHEET: "sheet",
  SLIDE: "slide",
  CODE: "code",
  ARCHIVE: "archive",
  OTHER: "other",
} as const satisfies Record<string, AttachmentCategory>

const EXACT_MIME_TO_CATEGORY: Record<string, AttachmentCategory> = {
  "application/pdf": "pdf",

  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "doc",
  "application/vnd.oasis.opendocument.text": "doc",
  "application/rtf": "doc",
  "text/rtf": "doc",

  "application/vnd.ms-excel": "sheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "sheet",
  "application/vnd.oasis.opendocument.spreadsheet": "sheet",
  "text/csv": "sheet",
  "text/tab-separated-values": "sheet",

  "application/vnd.ms-powerpoint": "slide",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "slide",
  "application/vnd.oasis.opendocument.presentation": "slide",

  "application/zip": "archive",
  "application/x-zip-compressed": "archive",
  "application/x-tar": "archive",
  "application/gzip": "archive",
  "application/x-gzip": "archive",
  "application/x-bzip2": "archive",
  "application/x-7z-compressed": "archive",
  "application/x-rar-compressed": "archive",
  "application/vnd.rar": "archive",

  "application/json": "code",
  "application/xml": "code",
  "application/x-yaml": "code",
  "application/x-sh": "code",
  "application/javascript": "code",
  "application/typescript": "code",
}

const CODE_TEXT_SUFFIXES = [
  "javascript",
  "typescript",
  "x-typescript",
  "x-python",
  "x-java",
  "x-c",
  "x-c++",
  "x-csharp",
  "x-go",
  "x-rust",
  "x-ruby",
  "x-shellscript",
  "x-sql",
  "yaml",
  "x-yaml",
  "xml",
  "html",
  "css",
  "markdown",
]

/**
 * Resolve a mime type string to an attachment category.
 * Comparison is case-insensitive on the type + subtype; parameters
 * (e.g. `; charset=utf-8`) are ignored.
 */
export function categoryFromMime(mime: string | null | undefined): AttachmentCategory {
  if (!mime) return "other"
  const normalized = mime.split(";")[0].trim().toLowerCase()
  if (!normalized) return "other"

  const exact = EXACT_MIME_TO_CATEGORY[normalized]
  if (exact) return exact

  if (normalized.startsWith("image/")) return "image"
  if (normalized.startsWith("video/")) return "video"
  if (normalized.startsWith("audio/")) return "audio"

  if (normalized.startsWith("text/")) {
    const subtype = normalized.slice("text/".length)
    if (CODE_TEXT_SUFFIXES.includes(subtype)) return "code"
    if (subtype === "plain") return "doc"
    return "doc"
  }

  return "other"
}

/**
 * Mime prefixes used by SQL LIKE queries to match a category. Returning a
 * list rather than a single string lets the repo OR-combine prefixes in a
 * `mime_type ILIKE ANY ($prefixes)` clause.
 *
 * For categories like "code" / "doc" / "archive" — where membership is
 * decided by exact mime equality rather than a prefix — we return the full
 * mime strings (LIKE without wildcards behaves as equality). The repo
 * augments this with explicit equality checks for completeness.
 */
export function mimePrefixesForCategory(category: AttachmentCategory): string[] {
  switch (category) {
    case "image":
      return ["image/%"]
    case "video":
      return ["video/%"]
    case "audio":
      return ["audio/%"]
    case "pdf":
      return ["application/pdf"]
    case "doc":
      return [
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.oasis.opendocument.text",
        "application/rtf",
        "text/rtf",
        "text/plain",
      ]
    case "sheet":
      return [
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.oasis.opendocument.spreadsheet",
        "text/csv",
        "text/tab-separated-values",
      ]
    case "slide":
      return [
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.oasis.opendocument.presentation",
      ]
    case "code":
      return [
        "application/json",
        "application/xml",
        "application/x-yaml",
        "application/x-sh",
        "application/javascript",
        "application/typescript",
        ...CODE_TEXT_SUFFIXES.map((suffix) => `text/${suffix}`),
      ]
    case "archive":
      return [
        "application/zip",
        "application/x-zip-compressed",
        "application/x-tar",
        "application/gzip",
        "application/x-gzip",
        "application/x-bzip2",
        "application/x-7z-compressed",
        "application/x-rar-compressed",
        "application/vnd.rar",
      ]
    case "other":
      return []
  }
}
