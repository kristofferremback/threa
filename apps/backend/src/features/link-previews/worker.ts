import type { Pool } from "pg"
import { logger } from "@threa/backend-common"
import type { Job, JobHandler } from "../../lib/queue"
import type { LinkPreviewExtractJobData } from "../../lib/queue/job-queue"
import { LinkPreviewService } from "./service"
import { LinkPreviewRepository, type UpdateLinkPreviewParams } from "./repository"
import { OutboxRepository } from "../../lib/outbox"
import { withTransaction } from "../../db"
import { detectContentType } from "./url-utils"
import { FETCH_TIMEOUT_MS, FETCH_USER_AGENT, MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH } from "./config"
import type { LinkPreviewSummary } from "@threa/types"

const log = logger.child({ module: "link-preview-worker" })

interface WorkerDeps {
  pool: Pool
  linkPreviewService: LinkPreviewService
}

/**
 * Fetch OpenGraph / meta tag metadata from a URL.
 * Runs outside of any DB transaction (INV-41).
 */
async function fetchMetadata(url: string): Promise<UpdateLinkPreviewParams> {
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

    const contentTypeHeader = response.headers.get("content-type") ?? ""

    // For images, we don't need to parse HTML
    if (contentTypeHeader.startsWith("image/")) {
      return {
        contentType: "image",
        status: "completed",
      }
    }

    // For PDFs, extract basic info from headers
    if (contentTypeHeader.includes("application/pdf")) {
      const disposition = response.headers.get("content-disposition") ?? ""
      const filenameMatch = disposition.match(/filename[*]?="?([^";]+)"?/)
      const filename = filenameMatch?.[1] ?? new URL(url).pathname.split("/").pop() ?? "Document"

      return {
        title: decodeURIComponent(filename).replace(/\.pdf$/i, ""),
        contentType: "pdf",
        status: "completed",
      }
    }

    // For HTML, parse meta tags
    if (!contentTypeHeader.includes("text/html") && !contentTypeHeader.includes("application/xhtml")) {
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
    // Match og:*, twitter:*, and name= meta tags
    const patterns = [
      new RegExp(`<meta[^>]+property=["']${escapeRegex(property)}["'][^>]+content=["']([^"']+)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escapeRegex(property)}["']`, "i"),
      new RegExp(`<meta[^>]+name=["']${escapeRegex(property)}["'][^>]+content=["']([^"']+)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escapeRegex(property)}["']`, "i"),
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
 * Processes URLs extracted from messages and fetches their metadata.
 */
export function createLinkPreviewWorker(deps: WorkerDeps): JobHandler<LinkPreviewExtractJobData> {
  return async (job: Job<LinkPreviewExtractJobData>) => {
    const { workspaceId, messageId, streamId, contentMarkdown } = job.data

    log.info({ messageId, workspaceId }, "Processing link previews for message")

    // 1. Extract URLs and create pending records (DB work)
    const pendingPreviews = await deps.linkPreviewService.extractAndCreatePending(
      workspaceId,
      messageId,
      contentMarkdown
    )

    if (pendingPreviews.length === 0) {
      log.debug({ messageId }, "No URLs found in message")
      return
    }

    // 2. Fetch metadata for each URL (network work — no DB connection held, INV-41)
    const fetchResults = await Promise.allSettled(
      pendingPreviews.map(async (p) => {
        const existing = await LinkPreviewRepository.findById(deps.pool, p.id)
        // Skip if already completed (cached from another message)
        if (existing?.status === "completed") return { id: p.id, skipped: true }

        const metadata = await fetchMetadata(p.url)
        return { id: p.id, metadata, skipped: false }
      })
    )

    // 3. Update DB with fetched metadata and publish outbox event
    await withTransaction(deps.pool, async (client) => {
      const completedPreviews: LinkPreviewSummary[] = []

      for (const result of fetchResults) {
        if (result.status === "rejected") continue
        const { id, metadata, skipped } = result.value
        if (skipped) {
          const existing = await LinkPreviewRepository.findById(client, id)
          if (existing) {
            completedPreviews.push({
              id: existing.id,
              url: existing.url,
              title: existing.title,
              description: existing.description,
              imageUrl: existing.imageUrl,
              faviconUrl: existing.faviconUrl,
              siteName: existing.siteName,
              contentType: existing.contentType,
              position: completedPreviews.length,
            })
          }
          continue
        }

        if (!metadata) continue
        const updated = await LinkPreviewRepository.updateMetadata(client, id, metadata)
        if (updated && updated.status === "completed") {
          completedPreviews.push({
            id: updated.id,
            url: updated.url,
            title: updated.title,
            description: updated.description,
            imageUrl: updated.imageUrl,
            faviconUrl: updated.faviconUrl,
            siteName: updated.siteName,
            contentType: updated.contentType,
            position: completedPreviews.length,
          })
        }
      }

      if (completedPreviews.length > 0) {
        await OutboxRepository.insert(client, "link_preview:ready", {
          workspaceId,
          streamId,
          messageId,
          previews: completedPreviews,
        })
      }
    })

    log.info({ messageId, count: pendingPreviews.length }, "Link preview extraction complete")
  }
}
