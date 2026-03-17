import { logger } from "@threa/backend-common"
import type { Job, JobHandler } from "../../lib/queue"
import type { LinkPreviewExtractJobData } from "../../lib/queue/job-queue"
import type { LinkPreviewService } from "./service"
import type { UpdateLinkPreviewParams } from "./repository"
import { detectContentType, isBlockedUrl } from "./url-utils"
import { FETCH_TIMEOUT_MS, FETCH_USER_AGENT, MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH } from "./config"

const log = logger.child({ module: "link-preview-worker" })

interface WorkerDeps {
  linkPreviewService: LinkPreviewService
}

/**
 * Fetch OpenGraph / meta tag metadata from a URL.
 * Runs outside of any DB transaction (INV-41).
 */
async function fetchMetadata(url: string): Promise<UpdateLinkPreviewParams> {
  // Defense-in-depth SSRF check (primary filter is in extractUrls)
  if (isBlockedUrl(url)) {
    log.warn({ url }, "Blocked SSRF attempt in fetchMetadata")
    return { status: "failed" }
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": FETCH_USER_AGENT,
        Accept: "text/html, application/xhtml+xml, */*",
      },
      signal: controller.signal,
      redirect: "follow",
    })

    clearTimeout(timeout)

    // Validate the final URL after redirects to prevent SSRF via open redirects
    if (response.url && isBlockedUrl(response.url)) {
      log.warn({ url, finalUrl: response.url }, "Redirect led to blocked internal URL")
      response.body?.cancel()
      return { status: "failed" }
    }

    const contentTypeHeader = response.headers.get("content-type") ?? ""

    // For images, we don't need to parse HTML
    if (contentTypeHeader.startsWith("image/")) {
      response.body?.cancel()
      return {
        contentType: "image",
        status: "completed",
      }
    }

    // For PDFs, extract basic info from headers
    if (contentTypeHeader.includes("application/pdf")) {
      response.body?.cancel()
      const disposition = response.headers.get("content-disposition") ?? ""
      const filenameMatch = disposition.match(/filename[*]?="?([^";]+)"?/)
      const filename = filenameMatch?.[1] ?? new URL(url).pathname.split("/").pop() ?? "Document"

      return {
        title: decodeURIComponent(filename).replace(/\.pdf$/i, ""),
        contentType: "pdf",
        status: "completed",
      }
    }

    // For non-HTML content types, detect from URL extension
    if (!contentTypeHeader.includes("text/html") && !contentTypeHeader.includes("application/xhtml")) {
      response.body?.cancel()
      return { status: "completed", contentType: detectContentType(url) }
    }

    // Only read first 100KB to avoid large pages
    const reader = response.body?.getReader()
    if (!reader) return { status: "failed" }

    let html = ""
    const decoder = new TextDecoder()
    const maxBytes = 100 * 1024
    let totalBytes = 0

    while (totalBytes < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      html += decoder.decode(value, { stream: true })
      totalBytes += value.byteLength
      // Stop once we have </head> — no need to parse body
      if (html.includes("</head>")) break
    }
    reader.cancel()

    return parseHtmlMeta(html, url)
  } catch (err) {
    log.warn({ err, url }, "Failed to fetch link preview metadata")
    return { status: "failed" }
  }
}

/**
 * Parse OpenGraph and standard meta tags from HTML head.
 */
export function parseHtmlMeta(html: string, url: string): UpdateLinkPreviewParams {
  const getMeta = (property: string): string | null => {
    // Match og:*, twitter:*, and name= meta tags.
    // Double-quoted and single-quoted content values are matched separately
    // so that apostrophes inside double-quoted values are not treated as delimiters.
    const prop = escapeRegex(property)
    const patterns = [
      // property="X" content="Y" (double-quoted content)
      new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content="([^"]*)"`, "i"),
      // property="X" content='Y' (single-quoted content)
      new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content='([^']*)'`, "i"),
      // content="Y" property="X" (reversed, double-quoted)
      new RegExp(`<meta[^>]+content="([^"]*)"[^>]+property=["']${prop}["']`, "i"),
      // content='Y' property="X" (reversed, single-quoted)
      new RegExp(`<meta[^>]+content='([^']*)'[^>]+property=["']${prop}["']`, "i"),
      // name="X" content="Y" (double-quoted)
      new RegExp(`<meta[^>]+name=["']${prop}["'][^>]+content="([^"]*)"`, "i"),
      // name="X" content='Y' (single-quoted)
      new RegExp(`<meta[^>]+name=["']${prop}["'][^>]+content='([^']*)'`, "i"),
      // content="Y" name="X" (reversed, double-quoted)
      new RegExp(`<meta[^>]+content="([^"]*)"[^>]+name=["']${prop}["']`, "i"),
      // content='Y' name="X" (reversed, single-quoted)
      new RegExp(`<meta[^>]+content='([^']*)'[^>]+name=["']${prop}["']`, "i"),
    ]
    for (const pattern of patterns) {
      const match = html.match(pattern)
      if (match?.[1]) return decodeHtmlEntities(match[1])
    }
    return null
  }

  const title = getMeta("og:title") ?? getMeta("twitter:title") ?? extractTitle(html)
  const description = getMeta("og:description") ?? getMeta("twitter:description") ?? getMeta("description")
  const imageUrl = getMeta("og:image") ?? getMeta("twitter:image")
  const siteName = getMeta("og:site_name")

  // Resolve favicon
  const faviconUrl = extractFavicon(html, url)

  return {
    title: title?.slice(0, MAX_TITLE_LENGTH) ?? null,
    description: description?.slice(0, MAX_DESCRIPTION_LENGTH) ?? null,
    imageUrl: imageUrl ? resolveUrl(imageUrl, url) : null,
    faviconUrl,
    siteName,
    contentType: "website",
    status: "completed",
  }
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return match?.[1] ? decodeHtmlEntities(match[1].trim()) : null
}

function extractFavicon(html: string, baseUrl: string): string | null {
  const patterns = [
    /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i,
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) return resolveUrl(match[1], baseUrl)
  }
  // Default favicon path
  try {
    const u = new URL(baseUrl)
    return `${u.origin}/favicon.ico`
  } catch {
    return null
  }
}

function resolveUrl(relative: string, base: string): string {
  try {
    return new URL(relative, base).toString()
  } catch {
    return relative
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Create the link preview extraction worker.
 * Thin handler: extracts URLs, fetches metadata (network, INV-41),
 * then delegates DB persistence + outbox to the service (INV-6, INV-34).
 */
export function createLinkPreviewWorker(deps: WorkerDeps): JobHandler<LinkPreviewExtractJobData> {
  return async (job: Job<LinkPreviewExtractJobData>) => {
    const { workspaceId, messageId, streamId, contentMarkdown } = job.data

    log.info({ messageId, workspaceId }, "Processing link previews for message")

    // 1. Extract URLs and create pending records (DB work via service)
    const pendingPreviews = await deps.linkPreviewService.extractAndCreatePending(
      workspaceId,
      messageId,
      contentMarkdown
    )

    if (pendingPreviews.length === 0) {
      log.debug({ messageId }, "No URLs found in message")
      return
    }

    // 2. Check which previews are already cached, then fetch metadata for the rest
    //    Network work runs outside any DB transaction (INV-41)
    const fetchResults = await Promise.allSettled(
      pendingPreviews.map(async (p) => {
        const alreadyCompleted = await deps.linkPreviewService.isCompleted(workspaceId, p.id)
        if (alreadyCompleted) return { id: p.id, skipped: true }

        const metadata = await fetchMetadata(p.url)
        return { id: p.id, metadata, skipped: false }
      })
    )

    // 3. Collect settled results, delegate persistence + outbox to service (INV-6)
    const settled = fetchResults
      .filter(
        (r): r is PromiseFulfilledResult<{ id: string; metadata?: UpdateLinkPreviewParams; skipped: boolean }> =>
          r.status === "fulfilled"
      )
      .map((r) => r.value)

    await deps.linkPreviewService.completePreviewsAndPublish(workspaceId, streamId, messageId, settled)

    log.info({ messageId, count: pendingPreviews.length }, "Link preview extraction complete")
  }
}
