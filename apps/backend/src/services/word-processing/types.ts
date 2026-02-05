/**
 * Interface for Word processing services.
 * Implemented by both the real service and stub service.
 */
export interface WordProcessingServiceLike {
  processWord(attachmentId: string): Promise<void>
}
