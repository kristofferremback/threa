import { DynamicStructuredTool } from "@langchain/core/tools"
import { z } from "zod"
import { logger } from "../../lib/logger"

const MAX_LINES_PER_REQUEST = 500

const LoadFileSectionSchema = z
  .object({
    attachmentId: z.string().describe("The ID of the text file attachment"),
    startLine: z.number().int().min(0).describe("Start line number (0-indexed, inclusive)"),
    endLine: z.number().int().min(0).describe("End line number (0-indexed, exclusive)"),
  })
  .refine((data) => data.startLine < data.endLine, {
    message: "startLine must be less than endLine",
    path: ["startLine"],
  })
  .refine((data) => data.endLine - data.startLine <= MAX_LINES_PER_REQUEST, {
    message: `Cannot load more than ${MAX_LINES_PER_REQUEST} lines at once`,
    path: ["endLine"],
  })

export type LoadFileSectionInput = z.infer<typeof LoadFileSectionSchema>

/**
 * Result from loading a file section.
 * Contains the text content for the requested line range.
 */
export interface LoadFileSectionResult {
  attachmentId: string
  filename: string
  startLine: number
  endLine: number
  totalLines: number
  /** Content for the requested lines */
  content: string
}

export interface LoadFileSectionCallbacks {
  loadFileSection: (input: LoadFileSectionInput) => Promise<LoadFileSectionResult | null>
}

/**
 * Creates a load_file_section tool for loading specific line ranges from large text files.
 *
 * This tool is only useful for large text files (>32KB) where full content isn't
 * injected into context. For small/medium files, full content is already available.
 *
 * Use the sections metadata from the attachment extraction to identify relevant
 * line ranges before calling this tool.
 */
export function createLoadFileSectionTool(callbacks: LoadFileSectionCallbacks) {
  return new DynamicStructuredTool({
    name: "load_file_section",
    description: `Load specific lines from a large text file. Only use this when:
- The file is large (>32KB) and injection strategy is "summary" (full content not in context)
- You need to read specific sections based on the section metadata
- The user asks about content in a specific section

The attachment extraction includes textMetadata.sections with line ranges. Use that to determine which lines to load.

For small/medium files (<32KB), full content is already available in fullText - don't use this tool.`,
    schema: LoadFileSectionSchema,
    func: async (input: LoadFileSectionInput) => {
      try {
        const result = await callbacks.loadFileSection(input)

        if (!result) {
          return JSON.stringify({
            error: "File not found, not accessible, or lines not available",
            attachmentId: input.attachmentId,
            startLine: input.startLine,
            endLine: input.endLine,
          })
        }

        logger.debug(
          {
            attachmentId: input.attachmentId,
            startLine: input.startLine,
            endLine: input.endLine,
            contentLength: result.content.length,
          },
          "File section loaded"
        )

        return JSON.stringify({
          filename: result.filename,
          lineRange: `${result.startLine}-${result.endLine - 1} of ${result.totalLines}`,
          content: result.content,
        })
      } catch (error) {
        logger.error({ error, ...input }, "Load file section failed")
        return JSON.stringify({
          error: `Failed to load file section: ${error instanceof Error ? error.message : "Unknown error"}`,
          attachmentId: input.attachmentId,
        })
      }
    },
  })
}
