import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import * as fs from "fs"
import type { S3Config } from "../env"

export interface StorageProvider {
  uploadFromPath(key: string, filePath: string, contentType: string): Promise<void>
  getSignedDownloadUrl(key: string, expiresIn?: number): Promise<string>
  delete(key: string): Promise<void>
}

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
    async uploadFromPath(key: string, filePath: string, contentType: string): Promise<void> {
      const fileStream = fs.createReadStream(filePath)

      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: fileStream,
          ContentType: contentType,
        })
      )
    },

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
  }
}
