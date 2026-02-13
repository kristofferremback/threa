import { tool } from "ai"
import { z } from "zod"
import { logger } from "../../../lib/logger"

const LoadAttachmentSchema = z.object({
  attachmentId: z.string().describe("The ID of the attachment to load for direct analysis"),
})

export type LoadAttachmentInput = z.infer<typeof LoadAttachmentSchema>

/**
 * Result from loading an attachment.
 * Contains the data URL for direct model analysis.
 */
export interface LoadAttachmentResult {
  id: string
  filename: string
  mimeType: string
  /** Base64-encoded data URL for direct model analysis */
  dataUrl: string
}

export interface LoadAttachmentCallbacks {
  loadAttachment: (input: LoadAttachmentInput) => Promise<LoadAttachmentResult | null>
}

/**
 * Marker interface for multimodal tool results.
 * When a tool returns this shape, the graph will create a ToolMessage
 * with multimodal content blocks instead of a JSON string.
 */
export interface MultimodalToolResult {
  __multimodal__: true
  content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>
}

/**
 * Type guard to check if a tool result is multimodal.
 */
export function isMultimodalToolResult(result: unknown): result is MultimodalToolResult {
  return (
    typeof result === "object" &&
    result !== null &&
    "__multimodal__" in result &&
    (result as MultimodalToolResult).__multimodal__ === true &&
    "content" in result &&
    Array.isArray((result as MultimodalToolResult).content)
  )
}

/**
 * Creates a load_attachment tool for loading attachments for direct model analysis.
 *
 * This tool is only available for vision-capable models and should only be injected
 * when the model supports image input modality.
 *
 * Returns a MultimodalToolResult so the graph can construct a ToolMessage with
 * proper image content blocks that vision models can actually see.
 */
export function createLoadAttachmentTool(callbacks: LoadAttachmentCallbacks) {
  return tool({
    description: `Load an attachment for direct visual analysis. Only use this for images when you need to:
- Analyze the actual visual content (not just the text extraction/caption)
- Identify specific visual elements, colors, or layouts
- Read text that may not have been extracted properly
- Understand diagrams, charts, or visual relationships

For text content from documents, prefer get_attachment which returns the extracted text.`,
    inputSchema: LoadAttachmentSchema,
    execute: async (input) => {
      try {
        const result = await callbacks.loadAttachment(input)

        if (!result) {
          return JSON.stringify({
            error: "Attachment not found, not accessible, or not an image",
            attachmentId: input.attachmentId,
          })
        }

        logger.debug({ attachmentId: input.attachmentId, mimeType: result.mimeType }, "Attachment loaded for analysis")

        // Return multimodal content that the graph will convert to proper ToolMessage content blocks
        // This allows vision models to actually "see" the image
        const multimodalResult: MultimodalToolResult = {
          __multimodal__: true,
          content: [
            { type: "text", text: `Image loaded: ${result.filename} (${result.mimeType})` },
            { type: "image_url", image_url: { url: result.dataUrl } },
          ],
        }

        return multimodalResult
      } catch (error) {
        logger.error({ error, attachmentId: input.attachmentId }, "Load attachment failed")
        return JSON.stringify({
          error: `Failed to load attachment: ${error instanceof Error ? error.message : "Unknown error"}`,
          attachmentId: input.attachmentId,
        })
      }
    },
  })
}
