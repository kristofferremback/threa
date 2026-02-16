import multer from "multer"
import multerS3 from "multer-s3"
import { S3Client } from "@aws-sdk/client-s3"
import type { Request, RequestHandler } from "express"
import type { S3Config } from "../lib/env"
import { attachmentId } from "../lib/id"

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

// Extend Express.Multer.File to include multer-s3 properties
declare global {
  namespace Express {
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
      const { workspaceId } = req.params
      const id = attachmentId()
      // Store the generated ID on the request for the handler to use
      req.attachmentId = id
      // Workspace-scoped path (no streamId - set when attached to message)
      const key = `${workspaceId}/${id}/${file.originalname}`
      cb(null, key)
    },
  })

  const upload = multer({
    storage,
    limits: {
      fileSize: MAX_FILE_SIZE,
      files: 1,
    },
  })

  return upload.single("file")
}

const AVATAR_MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

/**
 * Creates an avatar upload middleware using memory storage.
 * Memory storage is correct here: 5MB cap keeps memory bounded,
 * and we need the buffer for sharp processing before uploading to S3.
 */
export function createAvatarUploadMiddleware(): RequestHandler {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: AVATAR_MAX_FILE_SIZE,
      files: 1,
    },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
        cb(null, true)
      } else {
        cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: JPEG, PNG, GIF, WebP`))
      }
    },
  })

  return upload.single("avatar")
}

export { MAX_FILE_SIZE }
