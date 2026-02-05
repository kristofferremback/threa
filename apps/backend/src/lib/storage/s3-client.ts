import { S3Client, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import type { S3Config } from "../env"

export interface StorageProvider {
  getSignedDownloadUrl(key: string, expiresIn?: number): Promise<string>
  getObject(key: string): Promise<Buffer>
  /** Fetch first N bytes of an object using HTTP Range header */
  getObjectRange(key: string, start: number, end: number): Promise<Buffer>
  delete(key: string): Promise<void>
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

    async getObject(key: string): Promise<Buffer> {
      const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
      })
      const response = await client.send(command)

      if (!response.Body) {
        throw new Error(`No body in S3 response for key: ${key}`)
      }

      // Convert readable stream to Buffer
      const chunks: Uint8Array[] = []
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk)
      }
      return Buffer.concat(chunks)
    },

    async getObjectRange(key: string, start: number, end: number): Promise<Buffer> {
      const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Range: `bytes=${start}-${end}`,
      })
      const response = await client.send(command)

      if (!response.Body) {
        throw new Error(`No body in S3 response for key: ${key}`)
      }

      const chunks: Uint8Array[] = []
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk)
      }
      return Buffer.concat(chunks)
    },

    async delete(key: string): Promise<void> {
      await client.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: key,
        })
      )
    },
  }
}
