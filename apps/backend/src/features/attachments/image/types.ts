/**
 * Interface for the image thumbnail service. Implemented by the real sharp
 * service and a no-op stub (used when image processing is disabled in tests).
 */
export interface ImageThumbnailServiceLike {
  generateThumbnail(attachmentId: string): Promise<void>
}
