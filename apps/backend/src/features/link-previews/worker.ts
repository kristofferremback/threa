import { logger } from "@threa/backend-common"
import type { Job, JobHandler } from "../../lib/queue"
import type { LinkPreviewExtractJobData } from "../../lib/queue/job-queue"
import type { LinkPreviewService } from "./service"
import type { UpdateLinkPreviewParams } from "./repository"
import { detectContentType, isBlockedUrl } from "./url-utils"
import {
  FETCH_TIMEOUT_MS,
  FETCH_USER_AGENT,
  MAX_DESCRIPTION_LENGTH,
  MAX_HTML_BYTES,
  MAX_TITLE_LENGTH,
  OEMBED_PROVIDERS,
} from "./config"

const log = logger.child({ module: "link-preview-worker" })

interface WorkerDeps {
  linkPreviewService: LinkPreviewService
}

// ── oEmbed ──────────────────────────────────────────────────────────

interface OEmbedResponse {
  title?: string
  author_name?: string
  provider_name?: string
  thumbnail_url?: string
}

/**
 * Try fetching structured metadata via oEmbed for known providers.
 * Returns null if the URL doesn't match any known provider or the request fails.
 */
async function tryOEmbed(url: string): Promise<UpdateLinkPreviewParams | null> {
  const provider = OEMBED_PROVIDERS.find((p) => p.pattern.test(url))
  if (!provider) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const oembedUrl = `${provider.endpoint}?format=json&url=${encodeURIComponent(url)}`
    const response = await fetch(oembedUrl, {
      headers: { "User-Agent": FETCH_USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    })

    if (!response.ok) {
      response.body?.cancel()
      return null
    }

    const data = (await response.json()) as OEmbedResponse

    // Derive a favicon from the provider's origin
    let faviconUrl: string | null = null
    try {
      faviconUrl = `${new URL(url).origin}/favicon.ico`
    } catch {
      /* ignore */
    }

    return {
      title: data.title?.slice(0, MAX_TITLE_LENGTH) ?? null,
      description: null,
      imageUrl: data.thumbnail_url ?? null,
      faviconUrl,
      siteName: data.provider_name ?? null,
      contentType: "website",
      status: "completed",
    }
  } catch (err) {
    log.debug({ err, url }, "oEmbed fetch failed, falling back to HTML")
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// ── HTML metadata fetching ──────────────────────────────────────────

/**
 * Fetch OpenGraph / meta tag metadata from a URL.
 * Tries oEmbed first for known providers, then falls back to HTML parsing.
 * Runs outside of any DB transaction (INV-41).
 */
async function fetchMetadata(url: string): Promise<UpdateLinkPreviewParams> {
  // Defense-in-depth SSRF check (primary filter is in extractUrls)
  if (isBlockedUrl(url)) {
    log.warn({ url }, "Blocked SSRF attempt in fetchMetadata")
    return { status: "failed" }
  }

  // Fast path: try oEmbed for known providers
  const oembedResult = await tryOEmbed(url)
  if (oembedResult) return oembedResult

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": FETCH_USER_AGENT,
        Accept: "text/html, application/xhtml+xml, */*",
      },
      signal: controller.signal,
      redirect: "follow",
    })

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

    // Read HTML up to MAX_HTML_BYTES (some sites like YouTube put meta tags far into the response)
    const reader = response.body?.getReader()
    if (!reader) return { status: "failed" }

    let html = ""
    const decoder = new TextDecoder()
    let totalBytes = 0

    try {
      while (totalBytes < MAX_HTML_BYTES) {
        const { done, value } = await reader.read()
        if (done) break
        html += decoder.decode(value, { stream: true })
        totalBytes += value.byteLength
        // Stop once we have </head> — no need to parse body
        if (html.includes("</head>")) break
      }
    } finally {
      reader.cancel()
    }

    html += decoder.decode() // flush any buffered multi-byte characters
    return await parseHtmlMeta(html, url)
  } catch (err) {
    log.warn({ err, url }, "Failed to fetch link preview metadata")
    return { status: "failed" }
  } finally {
    clearTimeout(timeout)
  }
}

// ── HTML parsing via Bun's HTMLRewriter (lol-html) ──────────────────

/**
 * Parse OpenGraph and standard meta tags from HTML using Bun's HTMLRewriter.
 * Uses CSS selectors instead of regex for robust extraction from malformed HTML.
 */
export async function parseHtmlMeta(html: string, url: string): Promise<UpdateLinkPreviewParams> {
  const meta: Record<string, string> = {}
  let titleText = ""
  let faviconHref = ""

  const rewriter = new HTMLRewriter()
    .on("meta", {
      element(el) {
        const content = el.getAttribute("content")
        if (!content) return

        const property = el.getAttribute("property")
        if (property) {
          // Only capture first occurrence of each property (og: takes priority)
          if (!meta[property]) meta[property] = content
          return
        }

        const name = el.getAttribute("name")
        if (name) {
          if (!meta[name]) meta[name] = content
        }
      },
    })
    .on("title", {
      text(chunk) {
        titleText += chunk.text
      },
    })
    .on('link[rel="icon"], link[rel="shortcut icon"]', {
      element(el) {
        if (!faviconHref) {
          faviconHref = el.getAttribute("href") ?? ""
        }
      },
    })

  // HTMLRewriter requires consuming the transformed response to trigger handlers
  await rewriter.transform(new Response(html)).text()

  const title = decode(meta["og:title"]) ?? decode(meta["twitter:title"]) ?? (titleText.trim() || null)
  const description =
    decode(meta["og:description"]) ?? decode(meta["twitter:description"]) ?? decode(meta["description"]) ?? null
  const imageUrl = decode(meta["og:image"]) ?? decode(meta["twitter:image"]) ?? null
  const siteName = decode(meta["og:site_name"]) ?? null

  // Resolve favicon
  let faviconUrl: string | null = null
  if (faviconHref) {
    faviconUrl = resolveUrl(faviconHref, url)
  } else {
    try {
      faviconUrl = `${new URL(url).origin}/favicon.ico`
    } catch {
      /* ignore */
    }
  }

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

/** Decode HTML entities in attribute values (HTMLRewriter returns raw attribute text). */
function decode(value: string | undefined): string | null {
  if (!value) return null
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, "\u00A0")
}

function resolveUrl(relative: string, base: string): string {
  try {
    return new URL(relative, base).toString()
  } catch {
    return relative
  }
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
