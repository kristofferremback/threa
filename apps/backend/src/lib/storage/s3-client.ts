import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import type { S3Config } from "../env"
import { logger } from "../logger"

export interface StorageProvider {
  getSignedDownloadUrl(key: string, expiresIn?: number): Promise<string>
  delete(key: string): Promise<void>
  ensureBucket(): Promise<void>
}

/**
 * Creates an S3 storage provider for download URLs and deletions.
 * Uploads are handled by multer-s3 middleware (streaming, no temp files).
 */
export function createS3Storage(config: S3Config): StorageProvider {
  const client = new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    ...(config.endpoint && {
      endpoint: config.endpoint,
      forcePathStyle: true,
    }),
  })

  return {
    async getSignedDownloadUrl(key: string, expiresIn = 900): Promise<string> {
      const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
      })
      return getSignedUrl(client, command, { expiresIn })
    },

    async delete(key: string): Promise<void> {
      await client.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: key,
        })
      )
    },

    async ensureBucket(): Promise<void> {
      try {
        await client.send(new HeadBucketCommand({ Bucket: config.bucket }))
        logger.debug({ bucket: config.bucket }, "S3 bucket exists")
      } catch (error: unknown) {
        if (error && typeof error === "object" && "name" in error && error.name === "NotFound") {
          logger.info({ bucket: config.bucket }, "Creating S3 bucket")
          await client.send(new CreateBucketCommand({ Bucket: config.bucket }))
        } else {
          throw error
        }
      }
    },
  }
}
