/**
 * Text Processing Service
 *
 * Processes text-based attachments to extract structured information
 * that can be used by AI agents to understand file content.
 *
 * Uses the three-phase pattern (INV-41) to avoid holding database
 * connections during slow AI calls.
 */

import type { Pool } from "pg"
import type { TextFormat, TextSizeTier, InjectionStrategy, TextMetadata } from "@threa/types"
import { withClient, withTransaction } from "../../db"
import { extractionId } from "../../lib/id"
import { AttachmentRepository, AttachmentExtractionRepository } from "../../repositories"
import type { StorageProvider } from "../../lib/storage/s3-client"
import type { AI } from "../../lib/ai/ai"
import { ProcessingStatuses, TextSizeTiers, InjectionStrategies } from "@threa/types"
import { logger } from "../../lib/logger"
import {
  TEXT_SIZE_THRESHOLDS,
  TEXT_SUMMARY_MODEL_ID,
  TEXT_SUMMARY_TEMPERATURE,
  TEXT_SUMMARY_SYSTEM_PROMPT,
  TEXT_SUMMARY_USER_PROMPT,
  BINARY_DETECTION,
  textSummarySchema,
} from "./config"
import { isBinaryFile, normalizeEncoding, inferFormat } from "./detector"
import { getParser } from "./parsers"
import type { TextProcessingServiceLike } from "./types"

export interface TextProcessingServiceDeps {
  pool: Pool
  ai: AI
  storage: StorageProvider
}

export class TextProcessingService implements TextProcessingServiceLike {
  private readonly pool: Pool
  private readonly ai: AI
  private readonly storage: StorageProvider

  constructor(deps: TextProcessingServiceDeps) {
    this.pool = deps.pool
    this.ai = deps.ai
    this.storage = deps.storage
  }

  /**
   * Process a text attachment to extract structured information.
   *
   * Three-phase pattern (INV-41):
   * 1. Fetch attachment, set status='processing' (fast, ~50ms)
   * 2. Download file, detect format, parse (no DB, variable time)
   * 3. Insert extraction record, set status='completed'/'failed' (fast, ~50ms)
   */
  async processText(attachmentId: string): Promise<void> {
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

    log.info({ filename: attachment.filename, mimeType: attachment.mimeType }, "Processing text attachment")

    // =========================================================================
    // Phase 2: Download and analyze text file (NO database connection held)
    // =========================================================================
    let textContent: string
    let encoding: string
    let format: TextFormat
    let textMetadata: TextMetadata
    let summary: string
    let fullTextToStore: string | null

    try {
      // Step 1: Fetch first 8KB for binary detection (avoid downloading full file for binaries)
      const headBuffer = await this.storage.getObjectRange(attachment.storagePath, 0, BINARY_DETECTION.checkSize - 1)

      // Check if file is binary based on head chunk
      if (isBinaryFile(headBuffer)) {
        log.info({ filename: attachment.filename }, "File detected as binary, marking as skipped")
        await AttachmentRepository.updateProcessingStatus(this.pool, attachmentId, ProcessingStatuses.SKIPPED)
        return
      }

      // Step 2: File looks like text — download full content
      const fileBuffer = await this.storage.getObject(attachment.storagePath)

      // Normalize encoding to UTF-8
      const normalized = normalizeEncoding(fileBuffer)
      textContent = normalized.text
      encoding = normalized.encoding

      // Infer format from filename and content
      format = inferFormat(attachment.filename, textContent)

      // Parse using format-specific parser
      const parser = getParser(format)
      const parseResult = parser.parse(textContent, attachment.filename)

      // Determine size tier and injection strategy
      const totalBytes = fileBuffer.length
      const sizeTier = determineSizeTier(totalBytes)
      const injectionStrategy = determineInjectionStrategy(sizeTier)

      // Build text metadata
      textMetadata = {
        format: parseResult.format,
        sizeTier,
        injectionStrategy,
        totalLines: parseResult.totalLines,
        totalBytes,
        encoding,
        sections: parseResult.sections,
        structure: parseResult.structure,
      }

      // Determine what to store and summarize
      if (sizeTier === TextSizeTiers.LARGE) {
        // Large files: generate AI summary, don't store full content
        fullTextToStore = null

        const summaryResult = await this.ai.generateObject({
          model: TEXT_SUMMARY_MODEL_ID,
          schema: textSummarySchema,
          temperature: TEXT_SUMMARY_TEMPERATURE,
          messages: [
            { role: "system", content: TEXT_SUMMARY_SYSTEM_PROMPT },
            {
              role: "user",
              content: TEXT_SUMMARY_USER_PROMPT.replace("{filename}", attachment.filename)
                .replace("{totalLines}", String(parseResult.totalLines))
                .replace("{contentPreview}", parseResult.previewContent),
            },
          ],
          telemetry: {
            functionId: "text-summary",
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
        log.info({ format, sizeTier, summaryLength: summary.length }, "Text summary generated")
      } else {
        // Small/medium files: store full content, generate simple summary
        fullTextToStore = textContent
        summary = generateSimpleSummary(
          attachment.filename,
          format,
          parseResult.totalLines,
          totalBytes,
          parseResult.structure
        )
      }
    } catch (error) {
      // Log and re-throw - let job queue handle retries, DLQ hook will mark as failed
      log.error({ error }, "Text processing failed")
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
        sourceType: "text",
        textMetadata,
      })

      // Mark attachment as completed
      await AttachmentRepository.updateProcessingStatus(client, attachmentId, ProcessingStatuses.COMPLETED)
    })

    log.info({ format, sizeTier: textMetadata.sizeTier }, "Text extraction saved successfully")
  }
}

function determineSizeTier(totalBytes: number): TextSizeTier {
  if (totalBytes <= TEXT_SIZE_THRESHOLDS.smallBytes) {
    return TextSizeTiers.SMALL
  }
  if (totalBytes <= TEXT_SIZE_THRESHOLDS.mediumBytes) {
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

function generateSimpleSummary(
  filename: string,
  format: TextFormat,
  totalLines: number,
  totalBytes: number,
  structure: TextMetadata["structure"]
): string {
  const sizeDesc = totalBytes < 1024 ? `${totalBytes} bytes` : `${Math.round(totalBytes / 1024)}KB`

  let formatDesc: string
  switch (format) {
    case "markdown":
      formatDesc = "Markdown document"
      break
    case "json":
      formatDesc = "JSON data file"
      break
    case "yaml":
      formatDesc = "YAML configuration file"
      break
    case "csv":
      formatDesc = "CSV spreadsheet"
      break
    case "code":
      formatDesc = structure && "language" in structure ? `${structure.language} source code` : "Source code"
      break
    default:
      formatDesc = "Plain text file"
  }

  let structureDesc = ""
  if (structure) {
    if ("toc" in structure && structure.toc.length > 0) {
      structureDesc = ` with ${structure.toc.length} sections`
    } else if ("headers" in structure) {
      structureDesc = ` with ${structure.headers.length} columns and ${structure.rowCount} rows`
    } else if ("topLevelKeys" in structure && structure.topLevelKeys) {
      structureDesc = ` containing ${structure.topLevelKeys.length} top-level keys`
    } else if ("arrayLength" in structure && structure.arrayLength !== null) {
      structureDesc = ` containing ${structure.arrayLength} items`
    } else if ("exports" in structure && structure.exports) {
      structureDesc = ` defining ${structure.exports.length} exports`
    }
  }

  return `${formatDesc} "${filename}" (${totalLines} lines, ${sizeDesc})${structureDesc}.`
}
