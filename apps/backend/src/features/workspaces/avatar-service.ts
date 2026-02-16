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
      [...images.entries()].map(([size, processed]) => {
        const filename = `${basePath.split("/").pop()}.${size}.webp`
        if (!AvatarService.AVATAR_FILE_PATTERN.test(filename)) {
          throw new Error(`Generated avatar filename doesn't match read pattern: ${filename}`)
        }
        return this.storage.putObject(`${basePath}.${size}.webp`, processed, "image/webp")
      })
    )
  }

  /**
   * Upload the raw (unprocessed) image buffer to S3.
   * Returns the S3 key for later retrieval by the worker.
   */
  async uploadRaw(params: { buffer: Buffer; workspaceId: string; memberId: string }): Promise<string> {
    const { buffer, workspaceId, memberId } = params
    const timestamp = Date.now()
    const key = `avatars/${workspaceId}/${memberId}/${timestamp}.original`
    await this.storage.putObject(key, buffer, "application/octet-stream")
    return key
  }

  /**
   * Download a raw image buffer from S3 by key.
   */
  async downloadRaw(rawS3Key: string): Promise<Buffer> {
    return this.storage.getObject(rawS3Key)
  }

  /**
   * Delete a raw file from S3. Fire-and-forget — logs errors.
   */
  async deleteRawFile(rawS3Key: string): Promise<void> {
    try {
      await this.storage.delete(rawS3Key)
    } catch (error) {
      logger.warn({ error, rawS3Key }, "Failed to delete raw avatar file from S3")
    }
  }

  private static readonly AVATAR_FILE_PATTERN = /^\d+\.(256|64)\.webp$/

  /**
   * Stream an avatar file from S3. Validates filename format and constructs
   * the S3 key internally — callers don't need to know the storage layout.
   * Returns null if the filename doesn't match the expected pattern.
   */
  async streamAvatarFile(params: { workspaceId: string; memberId: string; file: string }): Promise<Readable | null> {
    if (!AvatarService.AVATAR_FILE_PATTERN.test(params.file)) return null
    const s3Key = `avatars/${params.workspaceId}/${params.memberId}/${params.file}`
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
