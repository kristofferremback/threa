import { z } from "zod"
import { AgentStepTypes } from "@threa/types"
import { logger } from "../../../lib/logger"
import { defineAgentTool, type AgentToolResult } from "../runtime"

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

export interface LoadFileSectionResult {
  attachmentId: string
  filename: string
  startLine: number
  endLine: number
  totalLines: number
  content: string
}

export interface LoadFileSectionCallbacks {
  loadFileSection: (input: LoadFileSectionInput) => Promise<LoadFileSectionResult | null>
}

export function createLoadFileSectionTool(callbacks: LoadFileSectionCallbacks) {
  return defineAgentTool({
    name: "load_file_section",
    description: `Load specific lines from a large text file. Only use this when:
- The file is large (>32KB) and injection strategy is "summary" (full content not in context)
- You need to read specific sections based on the section metadata
- The user asks about content in a specific section

The attachment extraction includes textMetadata.sections with line ranges. Use that to determine which lines to load.

For small/medium files (<32KB), full content is already available in fullText - don't use this tool.`,
    inputSchema: LoadFileSectionSchema,

    execute: async (input): Promise<AgentToolResult> => {
      try {
        const result = await callbacks.loadFileSection(input)

        if (!result) {
          return {
            output: JSON.stringify({
              error: "File not found, not accessible, or lines not available",
              attachmentId: input.attachmentId,
              startLine: input.startLine,
              endLine: input.endLine,
            }),
          }
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

        return {
          output: JSON.stringify({
            filename: result.filename,
            lineRange: `${result.startLine}-${result.endLine - 1} of ${result.totalLines}`,
            content: result.content,
          }),
        }
      } catch (error) {
        logger.error({ error, ...input }, "Load file section failed")
        return {
          output: JSON.stringify({
            error: `Failed to load file section: ${error instanceof Error ? error.message : "Unknown error"}`,
            attachmentId: input.attachmentId,
          }),
        }
      }
    },

    trace: {
      stepType: AgentStepTypes.TOOL_CALL,
      formatContent: (input) =>
        JSON.stringify({
          tool: "load_file_section",
          attachmentId: input.attachmentId,
          lines: `${input.startLine}-${input.endLine}`,
        }),
    },
  })
}
