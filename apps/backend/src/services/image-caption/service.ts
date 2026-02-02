/**
 * Image Caption Service
 *
 * Processes image attachments to extract structured information
 * that can be used by AI agents to understand visual content.
 *
 * Uses the three-phase pattern (INV-41) to avoid holding database
 * connections during slow AI calls.
 */

import type { Pool } from "pg"
import { withClient, withTransaction } from "../../db"
import { extractionId } from "../../lib/id"
import { AttachmentRepository, AttachmentExtractionRepository } from "../../repositories"
import type { StorageProvider } from "../../lib/storage/s3-client"
import type { AI } from "../../lib/ai/ai"
import { ProcessingStatuses } from "@threa/types"
import { logger } from "../../lib/logger"
import {
  IMAGE_CAPTION_MODEL_ID,
  IMAGE_CAPTION_TEMPERATURE,
  IMAGE_CAPTION_SYSTEM_PROMPT,
  IMAGE_CAPTION_USER_PROMPT,
  imageAnalysisSchema,
  type ImageAnalysisOutput,
} from "./config"
import type { ImageCaptionServiceLike } from "./types"

export interface ImageCaptionServiceDeps {
  pool: Pool
  ai: AI
  storage: StorageProvider
}

export class ImageCaptionService implements ImageCaptionServiceLike {
  private readonly pool: Pool
  private readonly ai: AI
  private readonly storage: StorageProvider

  constructor(deps: ImageCaptionServiceDeps) {
    this.pool = deps.pool
    this.ai = deps.ai
    this.storage = deps.storage
  }

  /**
   * Process an image attachment to extract structured information.
   *
   * Three-phase pattern (INV-41):
   * 1. Fetch attachment, set status='processing' (fast, ~50ms)
   * 2. Download image, call AI with base64 (no DB, 5-15s)
   * 3. Insert extraction record, set status='completed'/'failed' (fast, ~50ms)
   */
  async processImage(attachmentId: string): Promise<void> {
    const log = logger.child({ attachmentId })

    // =========================================================================
    // Phase 1: Fetch attachment and claim it for processing
    // =========================================================================
    const attachment = await withClient(this.pool, async (client) => {
      const att = await AttachmentRepository.findById(client, attachmentId)
      if (!att) {
        log.warn("Attachment not found, skipping")
        return null
      }

      // Atomic transition: only process if still pending
      const claimed = await AttachmentRepository.updateProcessingStatus(
        client,
        attachmentId,
        ProcessingStatuses.PROCESSING,
        { onlyIfStatus: ProcessingStatuses.PENDING }
      )

      if (!claimed) {
        log.info({ currentStatus: att.processingStatus }, "Attachment not in pending state, skipping")
        return null
      }

      return att
    })

    if (!attachment) {
      return
    }

    log.info({ filename: attachment.filename, mimeType: attachment.mimeType }, "Processing image attachment")

    // =========================================================================
    // Phase 2: Download and analyze image (NO database connection held)
    // =========================================================================
    let analysis: ImageAnalysisOutput

    try {
      // Download image from S3
      const imageBuffer = await this.storage.getObject(attachment.storagePath)
      const base64Image = imageBuffer.toString("base64")

      // Determine media type for the AI SDK
      const mediaType = attachment.mimeType.startsWith("image/") ? attachment.mimeType : "image/png" // Fallback for octet-stream

      // Call AI to analyze the image
      const { value } = await this.ai.generateObject({
        model: IMAGE_CAPTION_MODEL_ID,
        schema: imageAnalysisSchema,
        temperature: IMAGE_CAPTION_TEMPERATURE,
        messages: [
          {
            role: "system",
            content: IMAGE_CAPTION_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: [
              { type: "text", text: IMAGE_CAPTION_USER_PROMPT },
              {
                type: "image",
                image: base64Image,
                mimeType: mediaType,
              },
            ],
          },
        ],
        telemetry: {
          functionId: "image-caption",
          metadata: {
            attachment_id: attachmentId,
            workspace_id: attachment.workspaceId,
            filename: attachment.filename,
            mime_type: attachment.mimeType,
          },
        },
        context: {
          workspaceId: attachment.workspaceId,
        },
      })

      analysis = value
      log.info(
        { contentType: analysis.contentType, summaryLength: analysis.summary.length },
        "Image analysis completed"
      )
    } catch (error) {
      // Mark as failed and re-throw
      log.error({ error }, "Image analysis failed")

      await AttachmentRepository.updateProcessingStatus(this.pool, attachmentId, ProcessingStatuses.FAILED)

      throw error
    }

    // =========================================================================
    // Phase 3: Save extraction and mark as completed
    // =========================================================================
    await withTransaction(this.pool, async (client) => {
      // Build full_text from extracted text components
      const textParts: string[] = []
      if (analysis.extractedText?.headings?.length) {
        textParts.push(...analysis.extractedText.headings)
      }
      if (analysis.extractedText?.labels?.length) {
        textParts.push(...analysis.extractedText.labels)
      }
      if (analysis.extractedText?.body) {
        textParts.push(analysis.extractedText.body)
      }
      const fullText = textParts.length > 0 ? textParts.join("\n") : null

      // Insert extraction record
      await AttachmentExtractionRepository.insert(client, {
        id: extractionId(),
        attachmentId,
        workspaceId: attachment.workspaceId,
        contentType: analysis.contentType,
        summary: analysis.summary,
        fullText,
        structuredData: analysis.structuredData,
      })

      // Mark attachment as completed
      await AttachmentRepository.updateProcessingStatus(client, attachmentId, ProcessingStatuses.COMPLETED)
    })

    log.info("Image extraction saved successfully")
  }
}
