import { DynamicStructuredTool } from "@langchain/core/tools"
import { z } from "zod"
import { logger } from "../../../lib/logger"

const SearchAttachmentsSchema = z.object({
  query: z.string().describe("Search query to find attachments by filename or content"),
  contentTypes: z
    .array(z.string())
    .optional()
    .describe("Filter by content types: chart, table, diagram, screenshot, photo, document, other"),
  limit: z.number().optional().default(10).describe("Maximum number of results to return (default: 10)"),
})

export type SearchAttachmentsInput = z.infer<typeof SearchAttachmentsSchema>

export interface AttachmentSearchResult {
  id: string
  filename: string
  mimeType: string
  contentType: string | null
  summary: string | null
  streamId: string | null
  messageId: string | null
  createdAt: string
}

export interface SearchAttachmentsCallbacks {
  searchAttachments: (input: SearchAttachmentsInput) => Promise<AttachmentSearchResult[]>
}

const MAX_RESULTS = 20

/**
 * Creates a search_attachments tool for finding attachments in the workspace.
 */
export function createSearchAttachmentsTool(callbacks: SearchAttachmentsCallbacks) {
  return new DynamicStructuredTool({
    name: "search_attachments",
    description: `Search for attachments (images, documents, files) in the workspace. Use this to find:
- Images or screenshots shared in conversations
- Documents uploaded to streams
- Files matching a specific name or content description

The search matches against filenames and extracted content summaries.`,
    schema: SearchAttachmentsSchema,
    func: async (input: SearchAttachmentsInput) => {
      try {
        const limit = Math.min(input.limit ?? 10, MAX_RESULTS)
        const results = await callbacks.searchAttachments({ ...input, limit })

        if (results.length === 0) {
          return JSON.stringify({
            query: input.query,
            contentTypes: input.contentTypes,
            results: [],
            message: "No matching attachments found",
          })
        }

        logger.debug({ query: input.query, resultCount: results.length }, "Attachment search completed")

        return JSON.stringify({
          query: input.query,
          contentTypes: input.contentTypes,
          results: results.map((r) => ({
            id: r.id,
            filename: r.filename,
            mimeType: r.mimeType,
            contentType: r.contentType,
            summary: r.summary ? truncate(r.summary, 200) : null,
            streamId: r.streamId,
            messageId: r.messageId,
            date: r.createdAt,
          })),
        })
      } catch (error) {
        logger.error({ error, query: input.query }, "Attachment search failed")
        return JSON.stringify({
          error: `Search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          query: input.query,
        })
      }
    },
  })
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + "..."
}
