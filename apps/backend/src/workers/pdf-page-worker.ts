import type { PdfProcessPageJobData, JobHandler } from "../lib/job-queue"
import type { PdfProcessingServiceLike } from "../services/pdf-processing"
import { logger } from "../lib/logger"

export interface PdfPageWorkerDeps {
  pdfProcessingService: PdfProcessingServiceLike
}

/**
 * Create the PDF page processing job handler.
 *
 * Thin wrapper delegating to the service.
 * Processes a single page based on its classification.
 */
export function createPdfPageWorker(deps: PdfPageWorkerDeps): JobHandler<PdfProcessPageJobData> {
  const { pdfProcessingService } = deps

  return async (job) => {
    const { attachmentId, pageNumber, pdfJobId } = job.data

    logger.info({ jobId: job.id, attachmentId, pageNumber, pdfJobId }, "Processing PDF page job")

    await pdfProcessingService.processPage(attachmentId, pageNumber, pdfJobId)

    logger.info({ jobId: job.id, attachmentId, pageNumber }, "PDF page job completed")
  }
}
