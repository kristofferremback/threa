import { logger } from "../../lib/logger"
import type { ImageCaptionServiceLike } from "./types"

/**
 * Stub implementation of ImageCaptionService for testing.
 * Does nothing - images are simply not processed in stub mode.
 */
export class StubImageCaptionService implements ImageCaptionServiceLike {
  async processImage(attachmentId: string): Promise<void> {
    logger.debug({ attachmentId }, "Stub image caption service - skipping processing")
  }
}
