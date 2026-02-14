import { z } from "zod"
import { logger } from "../../../lib/logger"
import { defineAgentTool, type AgentToolResult } from "../runtime"

const MAX_PAGES_PER_REQUEST = 10

const LoadPdfSectionSchema = z
  .object({
    attachmentId: z.string().describe("The ID of the PDF attachment"),
    startPage: z.number().int().min(1).describe("Start page number (1-indexed, inclusive)"),
    endPage: z.number().int().min(1).describe("End page number (1-indexed, inclusive)"),
  })
  .refine((data) => data.startPage <= data.endPage, {
    message: "startPage must be less than or equal to endPage",
    path: ["startPage"],
  })
  .refine((data) => data.endPage - data.startPage + 1 <= MAX_PAGES_PER_REQUEST, {
    message: `Cannot load more than ${MAX_PAGES_PER_REQUEST} pages at once`,
    path: ["endPage"],
  })

export type LoadPdfSectionInput = z.infer<typeof LoadPdfSectionSchema>

export interface LoadPdfSectionResult {
  attachmentId: string
  filename: string
  startPage: number
  endPage: number
  totalPages: number
  content: string
  pages: Array<{ pageNumber: number; content: string }>
}

export interface LoadPdfSectionCallbacks {
  loadPdfSection: (input: LoadPdfSectionInput) => Promise<LoadPdfSectionResult | null>
}

export function createLoadPdfSectionTool(callbacks: LoadPdfSectionCallbacks) {
  return defineAgentTool({
    name: "load_pdf_section",
    description: `Load specific pages from a large PDF document. Only use this when:
- The PDF has more than 25 pages (large PDFs don't have full content in context)
- You need to read specific sections based on the section metadata
- The user asks about content that's in a specific page range

The attachment extraction includes section metadata with page ranges. Use that to determine which pages to load.

For small/medium PDFs (<25 pages), full content is already available in the extraction - don't use this tool.`,
    inputSchema: LoadPdfSectionSchema,

    execute: async (input): Promise<AgentToolResult> => {
      try {
        const result = await callbacks.loadPdfSection(input)

        if (!result) {
          return {
            output: JSON.stringify({
              error: "PDF not found, not accessible, or pages not available",
              attachmentId: input.attachmentId,
              startPage: input.startPage,
              endPage: input.endPage,
            }),
          }
        }

        logger.debug(
          {
            attachmentId: input.attachmentId,
            startPage: input.startPage,
            endPage: input.endPage,
            contentLength: result.content.length,
          },
          "PDF section loaded"
        )

        return {
          output: JSON.stringify({
            filename: result.filename,
            pageRange: `${result.startPage}-${result.endPage} of ${result.totalPages}`,
            content: result.content,
          }),
        }
      } catch (error) {
        logger.error({ error, ...input }, "Load PDF section failed")
        return {
          output: JSON.stringify({
            error: `Failed to load PDF section: ${error instanceof Error ? error.message : "Unknown error"}`,
            attachmentId: input.attachmentId,
          }),
        }
      }
    },

    trace: {
      stepType: "tool_call",
      formatContent: (input) =>
        JSON.stringify({
          tool: "load_pdf_section",
          attachmentId: input.attachmentId,
          pages: `${input.startPage}-${input.endPage}`,
        }),
    },
  })
}
