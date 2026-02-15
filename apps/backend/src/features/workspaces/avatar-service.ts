import sharp from "sharp"
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"
import type { S3Config } from "../../lib/env"
import { logger } from "../../lib/logger"

const AVATAR_SIZES = [256, 64] as const
const WEBP_QUALITY = 80

export class AvatarService {
  private s3Client: S3Client
  private bucket: string
  private endpoint: string | undefined

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
    this.endpoint = s3Config.endpoint
  }

  /**
   * Process an image buffer into two WebP variants and upload to S3.
   * Returns the base URL (without size suffix).
   */
  async processAndUpload(params: { buffer: Buffer; workspaceId: string; memberId: string }): Promise<string> {
    const { buffer, workspaceId, memberId } = params
    const timestamp = Date.now()
    const basePath = `avatars/${workspaceId}/${memberId}/${timestamp}`

    const uploads = AVATAR_SIZES.map(async (size) => {
      const processed = await sharp(buffer)
        .resize(size, size, { fit: "cover" })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer()

      const key = `${basePath}.${size}.webp`
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: processed,
          ContentType: "image/webp",
        })
      )
    })

    await Promise.all(uploads)

    // Build the base URL that the frontend will append size suffix to
    const host = this.endpoint ? `${this.endpoint}/${this.bucket}` : `https://${this.bucket}.s3.amazonaws.com`
    return `${host}/${basePath}`
  }

  /**
   * Delete both size variants from S3. Fire-and-forget — logs errors.
   */
  async deleteAvatarFiles(avatarUrl: string): Promise<void> {
    try {
      // Extract the path portion from the full URL
      const url = new URL(avatarUrl)
      const basePath = url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname
      // Remove bucket prefix if using path-style URLs
      const cleanPath = basePath.startsWith(`${this.bucket}/`) ? basePath.slice(this.bucket.length + 1) : basePath

      const deletes = AVATAR_SIZES.map((size) =>
        this.s3Client.send(
          new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: `${cleanPath}.${size}.webp`,
          })
        )
      )

      await Promise.all(deletes)
    } catch (error) {
      logger.warn({ error, avatarUrl }, "Failed to delete avatar files from S3")
    }
  }
}
