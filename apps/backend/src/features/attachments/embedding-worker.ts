import type { Pool } from "pg"
import type { AttachmentEmbeddingJobData, JobHandler } from "../../lib/queue"
import type { EmbeddingServiceLike } from "../memos"
import { logger } from "../../lib/logger"
import { AttachmentExtractionRepository } from "./extraction-repository"
import { isContentTypeEmbeddable, MIN_SUMMARY_LENGTH } from "./embedding-config"

export interface AttachmentEmbeddingWorkerDeps {
  pool: Pool
  embeddingService: EmbeddingServiceLike
}

/**
 * Generate a summary embedding for an attachment extraction so it becomes
 * semantically searchable.
 *
 * Three-phase pattern (INV-41) — embeddings call out to the model provider
 * and we must not hold a DB connection during that hop:
 *   Phase 1: fetch extraction (single query)
 *   Phase 2: generate embedding (no connection)
 *   Phase 3: write embedding (single query)
 *
 * Idempotent: re-running for the same attachment overwrites the column. The
 * worker re-applies the eligibility check defensively — even though the outbox
 * handler filters at enqueue time, an extraction can be reprocessed with a
 * different `content_type` between enqueue and execution.
 */
export function createAttachmentEmbeddingWorker(
  deps: AttachmentEmbeddingWorkerDeps
): JobHandler<AttachmentEmbeddingJobData> {
  const { pool, embeddingService } = deps

  return async (job) => {
    const { attachmentId, workspaceId } = job.data
    const log = logger.child({ jobId: job.id, attachmentId, workspaceId })

    const extraction = await AttachmentExtractionRepository.findByAttachmentId(pool, attachmentId)
    if (!extraction) {
      log.warn("Extraction not found, skipping embedding")
      return
    }

    if (extraction.workspaceId !== workspaceId) {
      // Sanity check — workspace shard boundary (INV-8). A mismatched workspace
      // means the job payload is stale or corrupt; refusing to embed is safer
      // than indexing under the wrong tenant.
      log.error({ extractionWorkspaceId: extraction.workspaceId }, "Workspace mismatch on embedding job")
      return
    }

    if (!isContentTypeEmbeddable(extraction.contentType)) {
      log.debug({ contentType: extraction.contentType }, "Skipping embedding for ineligible content type")
      return
    }

    const summary = extraction.summary.trim()
    if (summary.length < MIN_SUMMARY_LENGTH) {
      log.debug({ summaryLength: summary.length }, "Skipping embedding for very short summary")
      return
    }

    const embedding = await embeddingService.embed(summary, {
      workspaceId,
      functionId: "attachment-summary-embedding",
    })

    const updated = await AttachmentExtractionRepository.updateSummaryEmbedding(pool, attachmentId, embedding)
    if (!updated) {
      log.info("Extraction was deleted between fetch and write, embedding discarded")
      return
    }

    log.info({ contentType: extraction.contentType }, "Attachment summary embedding stored")
  }
}
