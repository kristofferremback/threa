/**
 * Word Processing Service
 *
 * Processes Word documents (.doc, .docx) to extract structured information
 * that can be used by AI agents to understand document content.
 *
 * Uses the three-phase pattern (INV-41) to avoid holding database
 * connections during slow AI calls.
 */

import type { Pool } from "pg"
import type { TextSizeTier, InjectionStrategy, TextSection, WordMetadata } from "@threa/types"
import { withClient, withTransaction } from "../../db"
import { extractionId } from "../../lib/id"
import { AttachmentRepository, AttachmentExtractionRepository } from "../../repositories"
import type { StorageProvider } from "../../lib/storage/s3-client"
import type { AI } from "../../lib/ai/ai"
import { ProcessingStatuses, TextSizeTiers, InjectionStrategies } from "@threa/types"
import { logger } from "../../lib/logger"
import {
  WORD_SIZE_THRESHOLDS,
  WORD_SUMMARY_MODEL_ID,
  WORD_SUMMARY_TEMPERATURE,
  WORD_SUMMARY_SYSTEM_PROMPT,
  WORD_SUMMARY_USER_PROMPT,
  WORD_IMAGE_CAPTION_MODEL_ID,
  WORD_IMAGE_CAPTION_TEMPERATURE,
  EMBEDDED_IMAGE_CAPTION_SYSTEM_PROMPT,
  EMBEDDED_IMAGE_CAPTION_USER_PROMPT,
  wordSummarySchema,
  embeddedImageCaptionSchema,
} from "./config"
import { validateWordFormat, type WordFormat } from "./detector"
import { extractWord, type ExtractedImage } from "./extractor"
import type { WordProcessingServiceLike } from "./types"

export interface WordProcessingServiceDeps {
  pool: Pool
  ai: AI
  storage: StorageProvider
}

export class WordProcessingService implements WordProcessingServiceLike {
  private readonly pool: Pool
  private readonly ai: AI
  private readonly storage: StorageProvider

  constructor(deps: WordProcessingServiceDeps) {
    this.pool = deps.pool
    this.ai = deps.ai
    this.storage = deps.storage
  }

  /**
   * Process a Word document attachment to extract structured information.
   *
   * Three-phase pattern (INV-41):
   * 1. Fetch attachment, set status='processing' (fast, ~50ms)
   * 2. Download file, extract content, process images (no DB, variable time)
   * 3. Insert extraction record, set status='completed'/'failed' (fast, ~50ms)
   */
  async processWord(attachmentId: string): Promise<void> {
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

      // Atomic transition: process if pending, processing, or failed (allows retries and un-DLQ)
      const claimed = await AttachmentRepository.updateProcessingStatus(
        client,
        attachmentId,
        ProcessingStatuses.PROCESSING,
        { onlyIfStatusIn: [ProcessingStatuses.PENDING, ProcessingStatuses.PROCESSING, ProcessingStatuses.FAILED] }
      )

      if (!claimed) {
        log.info({ currentStatus: att.processingStatus }, "Attachment already completed/skipped, skipping")
        return null
      }

      return att
    })

    if (!attachment) {
      return
    }

    log.info({ filename: attachment.filename, mimeType: attachment.mimeType }, "Processing Word document")

    // =========================================================================
    // Phase 2: Download and analyze Word document (NO database connection held)
    // =========================================================================
    let format: WordFormat
    let textContent: string
    let wordMetadata: WordMetadata
    let summary: string
    let fullTextToStore: string | null

    try {
      // Step 1: Download the file
      const fileBuffer = await this.storage.getObject(attachment.storagePath)

      // Step 2: Validate format using magic bytes
      format = validateWordFormat(fileBuffer)
      log.info({ format }, "Word format detected")

      // Step 3: Extract content
      const extracted = await extractWord(fileBuffer, format)
      textContent = extracted.text

      // Step 4: Process embedded images if any (DOCX only)
      let processedImageCaptions: string[] = []
      if (extracted.images.length > 0) {
        log.info({ imageCount: extracted.images.length }, "Processing embedded images")
        processedImageCaptions = await this.captionEmbeddedImages(
          extracted.images,
          attachment.workspaceId,
          attachmentId
        )
      }

      // Step 5: Integrate image captions into text
      const contentWithImages = this.integrateImageCaptions(textContent, processedImageCaptions)

      // Step 6: Calculate metrics
      const wordCount = countWords(textContent)
      const characterCount = textContent.length
      const contentBytes = Buffer.byteLength(contentWithImages, "utf-8")

      // Step 7: Determine size tier and injection strategy
      const sizeTier = determineSizeTier(contentBytes)
      const injectionStrategy = determineInjectionStrategy(sizeTier)

      // Step 8: Build sections for navigation
      const sections = buildSections(textContent)

      // Step 9: Build metadata
      wordMetadata = {
        format,
        sizeTier,
        injectionStrategy,
        pageCount: extracted.properties.pageCount,
        wordCount,
        characterCount,
        author: extracted.properties.author,
        createdAt: extracted.properties.createdAt?.toISOString() ?? null,
        modifiedAt: extracted.properties.modifiedAt?.toISOString() ?? null,
        embeddedImageCount: extracted.images.length,
        sections,
      }

      // Step 10: Determine what to store and summarize
      if (sizeTier === TextSizeTiers.LARGE) {
        // Large documents: generate AI summary, don't store full content
        fullTextToStore = null

        const contentPreview = textContent.slice(0, 4000)
        const summaryResult = await this.ai.generateObject({
          model: WORD_SUMMARY_MODEL_ID,
          schema: wordSummarySchema,
          temperature: WORD_SUMMARY_TEMPERATURE,
          messages: [
            { role: "system", content: WORD_SUMMARY_SYSTEM_PROMPT },
            {
              role: "user",
              content: WORD_SUMMARY_USER_PROMPT.replace("{filename}", attachment.filename)
                .replace("{wordCount}", String(wordCount))
                .replace("{contentPreview}", contentPreview),
            },
          ],
          telemetry: {
            functionId: "word-summary",
            metadata: {
              attachment_id: attachmentId,
              workspace_id: attachment.workspaceId,
              filename: attachment.filename,
              format,
              size_tier: sizeTier,
            },
          },
          context: {
            workspaceId: attachment.workspaceId,
          },
        })

        summary = summaryResult.value.summary
        log.info({ format, sizeTier, summaryLength: summary.length }, "Word summary generated")
      } else {
        // Small/medium documents: store full content with image captions
        fullTextToStore = contentWithImages
        summary = generateSimpleSummary(attachment.filename, format, wordCount, characterCount, extracted.images.length)
      }
    } catch (error) {
      // Check for password-protected or corrupted documents
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes("password") || errorMessage.includes("encrypted")) {
        log.info({ filename: attachment.filename }, "Password-protected document, marking as skipped")
        await AttachmentRepository.updateProcessingStatus(this.pool, attachmentId, ProcessingStatuses.SKIPPED)
        return
      }

      // Log and re-throw - let job queue handle retries, DLQ hook will mark as failed
      log.error({ error }, "Word processing failed")
      throw error
    }

    // =========================================================================
    // Phase 3: Save extraction and mark as completed
    // =========================================================================
    await withTransaction(this.pool, async (client) => {
      // Insert extraction record
      await AttachmentExtractionRepository.insert(client, {
        id: extractionId(),
        attachmentId,
        workspaceId: attachment.workspaceId,
        contentType: "document",
        summary,
        fullText: fullTextToStore,
        structuredData: null,
        sourceType: "word",
        wordMetadata,
      })

      // Mark attachment as completed
      await AttachmentRepository.updateProcessingStatus(client, attachmentId, ProcessingStatuses.COMPLETED)
    })

    log.info({ format, sizeTier: wordMetadata.sizeTier }, "Word extraction saved successfully")
  }

  /**
   * Caption embedded images using AI.
   */
  private async captionEmbeddedImages(
    images: ExtractedImage[],
    workspaceId: string,
    attachmentId: string
  ): Promise<string[]> {
    const captions: string[] = []

    for (const image of images) {
      try {
        // Skip non-standard image formats that models may not handle well
        if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(image.mimeType)) {
          captions.push(`[Image ${image.index + 1}: Embedded ${image.mimeType.split("/")[1]} image]`)
          continue
        }

        const result = await this.ai.generateObject({
          model: WORD_IMAGE_CAPTION_MODEL_ID,
          schema: embeddedImageCaptionSchema,
          temperature: WORD_IMAGE_CAPTION_TEMPERATURE,
          messages: [
            { role: "system", content: EMBEDDED_IMAGE_CAPTION_SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: EMBEDDED_IMAGE_CAPTION_USER_PROMPT },
                {
                  type: "image",
                  image: image.data,
                  mimeType: image.mimeType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
                },
              ],
            },
          ],
          telemetry: {
            functionId: "word-image-caption",
            metadata: {
              attachment_id: attachmentId,
              workspace_id: workspaceId,
              image_index: image.index,
            },
          },
          context: {
            workspaceId,
          },
        })

        captions.push(result.value.caption)
      } catch (error) {
        logger.warn({ error, imageIndex: image.index }, "Failed to caption embedded image")
        captions.push(`[Image ${image.index + 1}: Unable to process]`)
      }
    }

    return captions
  }

  /**
   * Integrate image captions into the text content.
   */
  private integrateImageCaptions(text: string, captions: string[]): string {
    if (captions.length === 0) {
      return text
    }

    // Append image descriptions at the end of the document
    const imageSection = captions.map((caption, i) => `[Image ${i + 1}: ${caption}]`).join("\n")
    return `${text}\n\n--- Embedded Images ---\n${imageSection}`
  }
}

function determineSizeTier(totalBytes: number): TextSizeTier {
  if (totalBytes <= WORD_SIZE_THRESHOLDS.smallBytes) {
    return TextSizeTiers.SMALL
  }
  if (totalBytes <= WORD_SIZE_THRESHOLDS.mediumBytes) {
    return TextSizeTiers.MEDIUM
  }
  return TextSizeTiers.LARGE
}

function determineInjectionStrategy(sizeTier: TextSizeTier): InjectionStrategy {
  switch (sizeTier) {
    case TextSizeTiers.SMALL:
      return InjectionStrategies.FULL
    case TextSizeTiers.MEDIUM:
      return InjectionStrategies.FULL_WITH_NOTE
    case TextSizeTiers.LARGE:
      return InjectionStrategies.SUMMARY
  }
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length
}

function buildSections(text: string): TextSection[] {
  const sections: TextSection[] = []
  const lines = text.split("\n")

  // Simple heuristic: look for lines that might be headings
  // (short lines followed by content, or lines in ALL CAPS)
  let currentSection: TextSection | null = null
  let lineNumber = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    lineNumber++

    // Skip empty lines
    if (!line) continue

    // Detect potential headings
    const isHeading =
      // Short lines (likely titles/headings)
      (line.length < 80 && line.length > 2 && !line.endsWith(".") && !line.endsWith(",")) ||
      // All caps (section headers)
      (line === line.toUpperCase() && line.length > 3 && /[A-Z]/.test(line)) ||
      // Numbered sections
      /^\d+\.?\s+[A-Z]/.test(line)

    if (isHeading) {
      // Close previous section
      if (currentSection) {
        currentSection.endLine = lineNumber - 1
        if (currentSection.endLine > currentSection.startLine) {
          sections.push(currentSection)
        }
      }

      // Start new section
      currentSection = {
        type: "heading",
        path: line.slice(0, 100),
        title: line.slice(0, 100),
        startLine: lineNumber,
        endLine: lineNumber,
      }
    }
  }

  // Close final section
  if (currentSection) {
    currentSection.endLine = lineNumber
    if (currentSection.endLine > currentSection.startLine) {
      sections.push(currentSection)
    }
  }

  return sections
}

function generateSimpleSummary(
  filename: string,
  format: WordFormat,
  wordCount: number,
  characterCount: number,
  imageCount: number
): string {
  const formatDesc = format === "docx" ? "Word document" : "Legacy Word document"
  const sizeDesc = characterCount < 1024 ? `${characterCount} characters` : `${Math.round(characterCount / 1024)}KB`

  let summary = `${formatDesc} "${filename}" (${wordCount} words, ${sizeDesc})`

  if (imageCount > 0) {
    summary += ` with ${imageCount} embedded image${imageCount > 1 ? "s" : ""}`
  }

  return summary + "."
}
