import { z } from "zod"
import { logger } from "../../../lib/logger"
import { defineAgentTool, type AgentToolResult } from "../runtime"

const LoadAttachmentSchema = z.object({
  attachmentId: z.string().describe("The ID of the attachment to load for direct analysis"),
})

export type LoadAttachmentInput = z.infer<typeof LoadAttachmentSchema>

export interface LoadAttachmentResult {
  id: string
  filename: string
  mimeType: string
  dataUrl: string
}

export interface LoadAttachmentCallbacks {
  loadAttachment: (input: LoadAttachmentInput) => Promise<LoadAttachmentResult | null>
}

export function createLoadAttachmentTool(callbacks: LoadAttachmentCallbacks) {
  return defineAgentTool({
    name: "load_attachment",
    description: `Load an attachment for direct visual analysis. Only use this for images when you need to:
- Analyze the actual visual content (not just the text extraction/caption)
- Identify specific visual elements, colors, or layouts
- Read text that may not have been extracted properly
- Understand diagrams, charts, or visual relationships

For text content from documents, prefer get_attachment which returns the extracted text.`,
    inputSchema: LoadAttachmentSchema,

    execute: async (input): Promise<AgentToolResult> => {
      try {
        const result = await callbacks.loadAttachment(input)

        if (!result) {
          return {
            output: JSON.stringify({
              error: "Attachment not found, not accessible, or not an image",
              attachmentId: input.attachmentId,
            }),
          }
        }

        logger.debug({ attachmentId: input.attachmentId, mimeType: result.mimeType }, "Attachment loaded for analysis")

        return {
          output: `Image loaded: ${result.filename} (${result.mimeType})`,
          multimodal: [{ type: "image", url: result.dataUrl }],
        }
      } catch (error) {
        logger.error({ error, attachmentId: input.attachmentId }, "Load attachment failed")
        return {
          output: JSON.stringify({
            error: `Failed to load attachment: ${error instanceof Error ? error.message : "Unknown error"}`,
            attachmentId: input.attachmentId,
          }),
        }
      }
    },

    trace: {
      stepType: "tool_call",
      formatContent: (input, result) => {
        if (result.multimodal && result.multimodal.length > 0) {
          return `Loaded image: ${input.attachmentId}`
        }
        return result.output
      },
    },
  })
}
