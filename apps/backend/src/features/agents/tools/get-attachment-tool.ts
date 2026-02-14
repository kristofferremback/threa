import { z } from "zod"
import {
  AgentStepTypes,
  type ExtractionContentType,
  type ChartData,
  type TableData,
  type DiagramData,
} from "@threa/types"
import { logger } from "../../../lib/logger"
import { AttachmentRepository, AttachmentExtractionRepository } from "../../attachments"
import { defineAgentTool, type AgentToolResult } from "../runtime"
import type { WorkspaceToolDeps } from "./tool-deps"

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

export function createGetAttachmentTool(deps: WorkspaceToolDeps) {
  const { db, accessibleStreamIds } = deps

  return defineAgentTool({
    name: "get_attachment",
    description: `Get full details about a specific attachment including its extracted content.

Use this after search_attachments to get:
- The complete extracted text from an image or document
- Structured data from charts, tables, or diagrams
- Full content that was summarized in the search results

This provides text-based analysis results. Use load_attachment if you need to directly analyze the visual content.`,
    inputSchema: GetAttachmentSchema,

    execute: async (input): Promise<AgentToolResult> => {
      try {
        const attachment = await AttachmentRepository.findById(db, input.attachmentId)
        if (!attachment) {
          return {
            output: JSON.stringify({
              error: "Attachment not found or you don't have access to it",
              attachmentId: input.attachmentId,
            }),
          }
        }
        if (!attachment.streamId || !accessibleStreamIds.includes(attachment.streamId)) {
          return {
            output: JSON.stringify({
              error: "Attachment not found or you don't have access to it",
              attachmentId: input.attachmentId,
            }),
          }
        }

        const extraction = await AttachmentExtractionRepository.findByAttachmentId(db, input.attachmentId)

        const result: AttachmentDetails = {
          id: attachment.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          processingStatus: attachment.processingStatus,
          createdAt: attachment.createdAt.toISOString(),
          extraction: extraction
            ? {
                contentType: extraction.contentType,
                summary: extraction.summary,
                fullText: extraction.fullText,
                structuredData: extraction.structuredData,
              }
            : null,
        }

        logger.debug({ attachmentId: input.attachmentId, hasExtraction: !!result.extraction }, "Attachment retrieved")

        return {
          output: JSON.stringify({
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
          }),
        }
      } catch (error) {
        logger.error({ error, attachmentId: input.attachmentId }, "Get attachment failed")
        return {
          output: JSON.stringify({
            error: `Failed to get attachment: ${error instanceof Error ? error.message : "Unknown error"}`,
            attachmentId: input.attachmentId,
          }),
        }
      }
    },

    trace: {
      stepType: AgentStepTypes.TOOL_CALL,
      formatContent: (input) => JSON.stringify({ tool: "get_attachment", attachmentId: input.attachmentId }),
    },
  })
}
