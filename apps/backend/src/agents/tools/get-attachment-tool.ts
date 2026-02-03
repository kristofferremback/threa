import { DynamicStructuredTool } from "@langchain/core/tools"
import { z } from "zod"
import type { ExtractionContentType, ChartData, TableData, DiagramData } from "@threa/types"
import { logger } from "../../lib/logger"

const GetAttachmentSchema = z.object({
  attachmentId: z.string().describe("The ID of the attachment to retrieve"),
})

export type GetAttachmentInput = z.infer<typeof GetAttachmentSchema>

export interface AttachmentDetails {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  processingStatus: string
  createdAt: string
  extraction: {
    contentType: ExtractionContentType
    summary: string
    fullText: string | null
    structuredData: ChartData | TableData | DiagramData | null
  } | null
}

export interface GetAttachmentCallbacks {
  getAttachment: (input: GetAttachmentInput) => Promise<AttachmentDetails | null>
}

/**
 * Creates a get_attachment tool for retrieving full attachment details.
 */
export function createGetAttachmentTool(callbacks: GetAttachmentCallbacks) {
  return new DynamicStructuredTool({
    name: "get_attachment",
    description: `Get full details about a specific attachment including its extracted content.

Use this after search_attachments to get:
- The complete extracted text from an image or document
- Structured data from charts, tables, or diagrams
- Full content that was summarized in the search results

This provides text-based analysis results. Use load_attachment if you need to directly analyze the visual content.`,
    schema: GetAttachmentSchema,
    func: async (input: GetAttachmentInput) => {
      try {
        const result = await callbacks.getAttachment(input)

        if (!result) {
          return JSON.stringify({
            error: "Attachment not found or you don't have access to it",
            attachmentId: input.attachmentId,
          })
        }

        logger.debug({ attachmentId: input.attachmentId, hasExtraction: !!result.extraction }, "Attachment retrieved")

        return JSON.stringify({
          id: result.id,
          filename: result.filename,
          mimeType: result.mimeType,
          sizeBytes: result.sizeBytes,
          processingStatus: result.processingStatus,
          createdAt: result.createdAt,
          extraction: result.extraction
            ? {
                contentType: result.extraction.contentType,
                summary: result.extraction.summary,
                fullText: result.extraction.fullText,
                structuredData: result.extraction.structuredData,
              }
            : null,
        })
      } catch (error) {
        logger.error({ error, attachmentId: input.attachmentId }, "Get attachment failed")
        return JSON.stringify({
          error: `Failed to get attachment: ${error instanceof Error ? error.message : "Unknown error"}`,
          attachmentId: input.attachmentId,
        })
      }
    },
  })
}
