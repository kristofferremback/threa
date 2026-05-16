import { isImageAttachment } from "../image-caption"

/**
 * Longest-edge pixel cap for the inline stream-view thumbnail. The inline
 * render is ~128px tall; 640px keeps it crisp on 2–3x displays while staying
 * a tiny fraction of the original's bytes.
 */
export const IMAGE_THUMBNAIL_MAX_DIMENSION = 640

/**
 * WebP quality for thumbnails — the smallest setting that still looks clean
 * for screenshots/photos at thumbnail scale.
 */
export const IMAGE_THUMBNAIL_WEBP_QUALITY = 72

/**
 * SVGs are already small vector files; rasterizing them to a fixed-size WebP
 * makes them larger and blurry, so we serve the original instead. Everything
 * else that `isImageAttachment` recognises (including image-typed
 * `application/octet-stream` uploads) is resizable by sharp.
 */
export function shouldGenerateThumbnail(mimeType: string, filename: string): boolean {
  if (mimeType === "image/svg+xml") return false
  return isImageAttachment(mimeType, filename)
}
