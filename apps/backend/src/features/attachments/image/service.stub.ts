import { logger } from "../../../lib/logger"
import type { ImageThumbnailServiceLike } from "./types"

/**
 * No-op thumbnail service for environments where image processing is disabled.
 * Thumbnails are optional — the stream view falls back to the raw image via
 * the `?variant=thumbnail` endpoint when none exists — so doing nothing is a
 * safe stub.
 */
export class StubImageThumbnailService implements ImageThumbnailServiceLike {
  async generateThumbnail(attachmentId: string): Promise<void> {
    logger.debug({ attachmentId }, "Stub image thumbnail service - no-op")
  }
}
