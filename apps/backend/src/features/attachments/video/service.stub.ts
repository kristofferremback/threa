import type { Pool } from "pg"
import { AttachmentRepository } from "../repository"
import { ProcessingStatuses } from "@threa/types"
import { logger } from "../../../lib/logger"
import type { VideoTranscodingServiceLike } from "./service"

/**
 * Stub video transcoding service for dev/test environments.
 * Immediately marks attachments as SKIPPED since MediaConvert is not available.
 */
export class StubVideoTranscodingService implements VideoTranscodingServiceLike {
  constructor(private readonly pool: Pool) {}

  async submit(attachmentId: string): Promise<void> {
    logger.info({ attachmentId }, "Stub video transcode: skipping (MediaConvert disabled)")
    await AttachmentRepository.updateProcessingStatus(this.pool, attachmentId, ProcessingStatuses.SKIPPED)
  }

  async checkStatus(_attachmentId: string): Promise<boolean> {
    return true
  }
}
