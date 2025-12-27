import { DynamicStructuredTool } from "@langchain/core/tools"
import { z } from "zod"
import { NodeHtmlMarkdown } from "node-html-markdown"
import { logger } from "../../lib/logger"

const ReadUrlSchema = z.object({
  url: z.string().url().describe("The URL of the web page to read"),
})

export type ReadUrlInput = z.infer<typeof ReadUrlSchema>

export interface ReadUrlResult {
  url: string
  title: string
  content: string
}

const MAX_CONTENT_LENGTH = 50000
const FETCH_TIMEOUT_MS = 30000

const nhm = new NodeHtmlMarkdown()

/**
 * Validates that a URL is safe to fetch (not internal/private network).
 * Returns error message if blocked, null if allowed.
 */
function validateUrl(url: string): string | null {
  try {
    const parsed = new URL(url)

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return `Unsupported protocol: ${parsed.protocol}. Only HTTP and HTTPS are allowed.`
    }

    const hostname = parsed.hostname.toLowerCase()

    // Block localhost
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return "Access to localhost is not allowed."
    }

    // Block private IP ranges (RFC 1918)
    if (hostname.match(/^10\./) || hostname.match(/^192\.168\./) || hostname.match(/^172\.(1[6-9]|2[0-9]|3[01])\./)) {
      return "Access to private network addresses is not allowed."
    }

    // Block link-local and cloud metadata endpoints
    if (hostname.match(/^169\.254\./)) {
      return "Access to link-local addresses is not allowed."
    }

    // Block common internal hostnames
    if (hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".localhost")) {
      return "Access to internal hostnames is not allowed."
    }

    return null
  } catch {
    return "Invalid URL format."
  }
}

/**
 * Creates a read_url tool for the agent to fetch full page content.
 *
 * Uses native fetch and converts HTML to markdown using node-html-markdown.
 */
export function createReadUrlTool() {
  return new DynamicStructuredTool({
    name: "read_url",
    description:
      "Fetch and read the full content of a web page. Use this after web_search when you need more detail than the snippet provides, or when the user shares a specific URL to analyze.",
    schema: ReadUrlSchema,
    func: async (input: ReadUrlInput) => {
      const validationError = validateUrl(input.url)
      if (validationError) {
        logger.warn({ url: input.url, reason: validationError }, "URL blocked by SSRF protection")
        return JSON.stringify({
          error: validationError,
          url: input.url,
        })
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

      try {
        const response = await fetch(input.url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "Threa-Agent/1.0 (https://threa.app)",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          redirect: "follow",
        })

        if (!response.ok) {
          logger.warn({ url: input.url, status: response.status }, "Failed to fetch URL")
          return JSON.stringify({
            error: `Failed to fetch URL: ${response.status} ${response.statusText}`,
            url: input.url,
          })
        }

        const contentType = response.headers.get("content-type") || ""
        if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
          return JSON.stringify({
            error: `Unsupported content type: ${contentType}. Only HTML and plain text are supported.`,
            url: input.url,
          })
        }

        const html = await response.text()

        const title = extractTitle(html)

        // For plain text, just use the content directly; for HTML, convert to markdown
        let content: string
        if (contentType.includes("text/plain")) {
          content = html
        } else {
          content = nhm.translate(html)
        }

        if (content.length > MAX_CONTENT_LENGTH) {
          content = content.slice(0, MAX_CONTENT_LENGTH) + "\n\n[Content truncated...]"
        }

        const result: ReadUrlResult = {
          url: input.url,
          title,
          content,
        }

        logger.debug({ url: input.url, contentLength: content.length }, "URL read completed")

        return JSON.stringify(result)
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          logger.warn({ url: input.url }, "URL fetch timed out")
          return JSON.stringify({
            error: `Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`,
            url: input.url,
          })
        }

        logger.error({ error, url: input.url }, "Failed to read URL")
        return JSON.stringify({
          error: `Failed to read URL: ${error instanceof Error ? error.message : "Unknown error"}`,
          url: input.url,
        })
      } finally {
        clearTimeout(timeout)
      }
    },
  })
}

function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  return titleMatch?.[1]?.trim() || "Untitled"
}
