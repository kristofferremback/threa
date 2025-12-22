import multer from "multer"
import multerS3 from "multer-s3"
import { S3Client } from "@aws-sdk/client-s3"
import type { Request, RequestHandler } from "express"
import type { S3Config } from "../lib/env"
import { attachmentId } from "../lib/id"

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

const ALLOWED_MIME_TYPES = [
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  // Documents
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  // Code files
  "text/javascript",
  "application/javascript",
  "text/typescript",
  "application/json",
  "text/html",
  "text/css",
  // Archives
  "application/zip",
  "application/gzip",
]

function fileFilter(_req: Request, file: Express.Multer.File, callback: multer.FileFilterCallback): void {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    callback(null, true)
  } else {
    callback(new Error(`File type ${file.mimetype} not allowed`))
  }
}

// Extend Express.Multer.File to include multer-s3 properties
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Multer {
      interface File {
        bucket?: string
        key?: string
        location?: string
        etag?: string
      }
    }
  }
}

// Extend Request to include the generated attachment ID
declare module "express" {
  interface Request {
    attachmentId?: string
  }
}

export interface UploadMiddlewareConfig {
  s3Config: S3Config
}

/**
 * Creates an upload middleware that streams files directly to S3.
 * No temp files are written to disk - prevents DoS via disk exhaustion.
 */
export function createUploadMiddleware({ s3Config }: UploadMiddlewareConfig): RequestHandler {
  const s3Client = new S3Client({
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

  const storage = multerS3({
    s3: s3Client,
    bucket: s3Config.bucket,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req: Request, file: Express.Multer.File, cb) => {
      const { workspaceId, streamId } = req.params
      const id = attachmentId()
      // Store the generated ID on the request for the handler to use
      req.attachmentId = id
      const key = `${workspaceId}/${streamId}/${id}/${file.originalname}`
      cb(null, key)
    },
  })

  const upload = multer({
    storage,
    limits: {
      fileSize: MAX_FILE_SIZE,
      files: 1,
    },
    fileFilter,
  })

  return upload.single("file")
}

export { MAX_FILE_SIZE, ALLOWED_MIME_TYPES }
