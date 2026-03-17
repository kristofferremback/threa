import type { LinkPreviewContentType } from "@threa/types"

/** Tracking parameters to strip during normalization */
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "ref",
  "source",
])

/**
 * Normalize a URL for deduplication.
 * Lowercases host, strips tracking parameters, removes trailing slash.
 */
export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw)
    url.hostname = url.hostname.toLowerCase()

    // Strip tracking params
    for (const param of TRACKING_PARAMS) {
      url.searchParams.delete(param)
    }

    // Sort remaining params for consistent ordering
    url.searchParams.sort()

    // Remove trailing slash from pathname (but keep root /)
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1)
    }

    // Remove default ports
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
      url.port = ""
    }

    // Remove fragment
    url.hash = ""

    return url.toString()
  } catch {
    return raw.toLowerCase()
  }
}

/** URL patterns to skip (internal protocols, data URIs, etc.) */
const SKIP_PATTERNS = [
  /^attachment:/,
  /^data:/,
  /^javascript:/i,
  /^mailto:/,
  /^tel:/,
  /^#/,
  /^\//, // relative paths
]

/**
 * Extract HTTP(S) URLs from markdown content.
 * Returns unique URLs in order of first appearance.
 */
export function extractUrls(markdown: string): string[] {
  // Match URLs in markdown links [text](url) and bare URLs
  const urlRegex = /(?:\[(?:[^\]]*)\]\(([^)]+)\))|(?:(?:^|\s)(https?:\/\/[^\s<>)"]+))/gm
  const seen = new Set<string>()
  const urls: string[] = []

  let match
  while ((match = urlRegex.exec(markdown)) !== null) {
    const url = (match[1] ?? match[2])?.trim()
    if (!url) continue

    // Skip non-http protocols and internal links
    if (SKIP_PATTERNS.some((p) => p.test(url))) continue

    // Must be a valid URL
    try {
      new URL(url)
    } catch {
      continue
    }

    const normalized = normalizeUrl(url)
    if (!seen.has(normalized)) {
      seen.add(normalized)
      urls.push(url)
    }
  }

  return urls
}

/** Image file extensions */
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "ico", "bmp", "avif"])

/** PDF extension */
const PDF_EXTENSION = "pdf"

/**
 * Detect content type from URL extension.
 * Falls back to "website" if no specific type is detected.
 */
export function detectContentType(url: string): LinkPreviewContentType {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    const ext = pathname.split(".").pop() ?? ""

    if (IMAGE_EXTENSIONS.has(ext)) return "image"
    if (ext === PDF_EXTENSION) return "pdf"
    return "website"
  } catch {
    return "website"
  }
}
