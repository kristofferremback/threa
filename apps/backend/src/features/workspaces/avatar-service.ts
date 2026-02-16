import { Readable } from "node:stream"
import sharp from "sharp"
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import type { S3Config } from "../../lib/env"
import { logger } from "../../lib/logger"

const AVATAR_SIZES = [256, 64] as const
const WEBP_QUALITY = 80

export class AvatarService {
  private s3Client: S3Client
  private bucket: string

  constructor(s3Config: S3Config) {
    this.s3Client = new S3Client({
      region: s3Config.region,
      credentials: {
        accessKeyId: s3Config.accessKeyId,
        secretAccessKey: s3Config.secretAccessKey,
      },
      ...(s3Config.endpoint && {
        endpoint: s3Config.endpoint,
        forcePathStyle: true,
      }),
    })
    this.bucket = s3Config.bucket
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
        this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: `${basePath}.${size}.webp`,
            Body: processed,
            ContentType: "image/webp",
          })
        )
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
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: s3Key })
    const response = await this.s3Client.send(command)

    if (!response.Body) {
      throw new Error(`No body in S3 response for key: ${s3Key}`)
    }

    return response.Body as Readable
  }

  /**
   * Delete both size variants from S3. Fire-and-forget — logs errors.
   */
  async deleteAvatarFiles(avatarKeyBase: string): Promise<void> {
    try {
      const deletes = AVATAR_SIZES.map((size) =>
        this.s3Client.send(
          new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: `${avatarKeyBase}.${size}.webp`,
          })
        )
      )

      await Promise.all(deletes)
    } catch (error) {
      logger.warn({ error, avatarKeyBase }, "Failed to delete avatar files from S3")
    }
  }
}
