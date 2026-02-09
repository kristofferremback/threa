import type { StreamNamingServiceLike } from "./naming-worker"
import { logger } from "../../lib/logger"

/**
 * Stub implementation of StreamNamingService for testing.
 * Always returns false (no naming performed).
 */
export class StubStreamNamingService implements StreamNamingServiceLike {
  async attemptAutoNaming(streamId: string, _requireName: boolean): Promise<boolean> {
    logger.debug({ streamId }, "Stub naming service - skipping auto-naming")
    return false
  }
}
