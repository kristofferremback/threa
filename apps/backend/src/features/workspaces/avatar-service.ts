import { Readable } from "node:stream"
import sharp from "sharp"
import type { StorageProvider } from "../../lib/storage/s3-client"
import { logger } from "../../lib/logger"

const AVATAR_SIZES = [256, 64] as const
const WEBP_QUALITY = 80

export class AvatarService {
  private storage: StorageProvider

  constructor(storage: StorageProvider) {
    this.storage = storage
  }

  /**
   * Process an image buffer into WebP variants at each AVATAR_SIZES dimension.
   * Pure image transformation — no I/O.
   */
  async processImages(buffer: Buffer): Promise<Map<number, Buffer>> {
    const results = new Map<number, Buffer>()
    await Promise.all(
      AVATAR_SIZES.map(async (size) => {
        const processed = await sharp(buffer)
          .resize(size, size, { fit: "cover" })
          .webp({ quality: WEBP_QUALITY })
          .toBuffer()
        results.set(size, processed)
      })
    )
    return results
  }

  /**
   * Upload pre-processed image buffers to S3 under the given base path.
   */
  async uploadImages(basePath: string, images: Map<number, Buffer>): Promise<void> {
    await Promise.all(
      [...images.entries()].map(([size, processed]) =>
        this.storage.putObject(`${basePath}.${size}.webp`, processed, "image/webp")
      )
    )
  }

  /**
   * Process an image buffer into two WebP variants and upload to S3.
   * Returns the S3 key base path (without size suffix) — frontend
   * constructs display URLs via getAvatarUrl() which points to the
   * backend proxy endpoint.
   */
  async processAndUpload(params: { buffer: Buffer; workspaceId: string; memberId: string }): Promise<string> {
    const { buffer, workspaceId, memberId } = params
    const timestamp = Date.now()
    const basePath = `avatars/${workspaceId}/${memberId}/${timestamp}`
    const images = await this.processImages(buffer)
    await this.uploadImages(basePath, images)
    return basePath
  }

  /**
   * Stream an avatar image from S3 by its full key (including size suffix).
   * Returns a Node readable stream to pipe directly to the HTTP response.
   */
  async streamImage(s3Key: string): Promise<Readable> {
    return this.storage.getObjectStream(s3Key)
  }

  /**
   * Delete both size variants from S3. Fire-and-forget — logs errors.
   */
  async deleteAvatarFiles(avatarKeyBase: string): Promise<void> {
    try {
      await Promise.all(AVATAR_SIZES.map((size) => this.storage.delete(`${avatarKeyBase}.${size}.webp`)))
    } catch (error) {
      logger.warn({ error, avatarKeyBase }, "Failed to delete avatar files from S3")
    }
  }
}
