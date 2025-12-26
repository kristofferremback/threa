import { DynamicStructuredTool } from "@langchain/core/tools"
import { z } from "zod"
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

/**
 * Creates a read_url tool for the agent to fetch full page content.
 *
 * Uses native fetch and extracts text content from HTML.
 */
export function createReadUrlTool() {
  return new DynamicStructuredTool({
    name: "read_url",
    description:
      "Fetch and read the full content of a web page. Use this after web_search when you need more detail than the snippet provides, or when the user shares a specific URL to analyze.",
    schema: ReadUrlSchema,
    func: async (input: ReadUrlInput) => {
      try {
        const response = await fetch(input.url, {
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
        let content = extractTextContent(html)

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
        logger.error({ error, url: input.url }, "Failed to read URL")
        return JSON.stringify({
          error: `Failed to read URL: ${error instanceof Error ? error.message : "Unknown error"}`,
          url: input.url,
        })
      }
    },
  })
}

function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return titleMatch ? titleMatch[1].trim() : "Untitled"
}

function extractTextContent(html: string): string {
  let text = html

  // Remove script and style elements
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")

  // Remove head section
  text = text.replace(/<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>/gi, "")

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, "")

  // Convert block-level elements to newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, "\n")
  text = text.replace(/<br[^>]*\/?>/gi, "\n")

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, "")

  // Decode common HTML entities
  text = text.replace(/&nbsp;/gi, " ")
  text = text.replace(/&amp;/gi, "&")
  text = text.replace(/&lt;/gi, "<")
  text = text.replace(/&gt;/gi, ">")
  text = text.replace(/&quot;/gi, '"')
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
  text = text.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))

  // Normalize whitespace
  text = text.replace(/[ \t]+/g, " ")
  text = text.replace(/\n[ \t]+/g, "\n")
  text = text.replace(/[ \t]+\n/g, "\n")
  text = text.replace(/\n{3,}/g, "\n\n")

  return text.trim()
}
