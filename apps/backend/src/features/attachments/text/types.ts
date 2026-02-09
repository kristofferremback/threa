/**
 * Interface for text processing services.
 * Implemented by both the real service (parse-based) and stub service (no-op).
 */
export interface TextProcessingServiceLike {
  processText(attachmentId: string): Promise<void>
}
