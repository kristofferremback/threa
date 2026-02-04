import { DynamicStructuredTool } from "@langchain/core/tools"
import { z } from "zod"
import { logger } from "../../lib/logger"

const LoadPdfSectionSchema = z.object({
  attachmentId: z.string().describe("The ID of the PDF attachment"),
  startPage: z.number().int().min(1).describe("Start page number (1-indexed, inclusive)"),
  endPage: z.number().int().min(1).describe("End page number (1-indexed, inclusive)"),
})

export type LoadPdfSectionInput = z.infer<typeof LoadPdfSectionSchema>

/**
 * Result from loading a PDF section.
 * Contains the full text content for the requested page range.
 */
export interface LoadPdfSectionResult {
  attachmentId: string
  filename: string
  startPage: number
  endPage: number
  totalPages: number
  /** Combined content from all pages in range */
  content: string
  /** Individual page contents if available */
  pages: Array<{
    pageNumber: number
    content: string
  }>
}

export interface LoadPdfSectionCallbacks {
  loadPdfSection: (input: LoadPdfSectionInput) => Promise<LoadPdfSectionResult | null>
}

/**
 * Creates a load_pdf_section tool for loading specific page ranges from large PDFs.
 *
 * This tool is only useful for large PDFs (>25 pages) where full content isn't
 * injected into context. For small/medium PDFs, full content is already available.
 *
 * Use the sections metadata from the attachment extraction to identify relevant
 * page ranges before calling this tool.
 */
export function createLoadPdfSectionTool(callbacks: LoadPdfSectionCallbacks) {
  return new DynamicStructuredTool({
    name: "load_pdf_section",
    description: `Load specific pages from a large PDF document. Only use this when:
- The PDF has more than 25 pages (large PDFs don't have full content in context)
- You need to read specific sections based on the section metadata
- The user asks about content that's in a specific page range

The attachment extraction includes section metadata with page ranges. Use that to determine which pages to load.

For small/medium PDFs (<25 pages), full content is already available in the extraction - don't use this tool.`,
    schema: LoadPdfSectionSchema,
    func: async (input: LoadPdfSectionInput) => {
      try {
        // Validate page range
        if (input.startPage > input.endPage) {
          return JSON.stringify({
            error: "startPage must be less than or equal to endPage",
            startPage: input.startPage,
            endPage: input.endPage,
          })
        }

        // Limit page range to prevent loading too much content
        const maxPagesPerRequest = 10
        if (input.endPage - input.startPage + 1 > maxPagesPerRequest) {
          return JSON.stringify({
            error: `Cannot load more than ${maxPagesPerRequest} pages at once. Please narrow your page range.`,
            startPage: input.startPage,
            endPage: input.endPage,
            requestedPages: input.endPage - input.startPage + 1,
            maxAllowed: maxPagesPerRequest,
          })
        }

        const result = await callbacks.loadPdfSection(input)

        if (!result) {
          return JSON.stringify({
            error: "PDF not found, not accessible, or pages not available",
            attachmentId: input.attachmentId,
            startPage: input.startPage,
            endPage: input.endPage,
          })
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

        // Return the content in a format that's easy for the model to process
        return JSON.stringify({
          filename: result.filename,
          pageRange: `${result.startPage}-${result.endPage} of ${result.totalPages}`,
          content: result.content,
        })
      } catch (error) {
        logger.error({ error, ...input }, "Load PDF section failed")
        return JSON.stringify({
          error: `Failed to load PDF section: ${error instanceof Error ? error.message : "Unknown error"}`,
          attachmentId: input.attachmentId,
        })
      }
    },
  })
}
