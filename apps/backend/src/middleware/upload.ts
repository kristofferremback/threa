import multer from "multer"
import os from "os"
import path from "path"
import type { Request } from "express"

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

const storage = multer.diskStorage({
  destination: os.tmpdir(),
  filename: (_req: Request, file: Express.Multer.File, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const ext = path.extname(file.originalname)
    cb(null, `upload-${uniqueSuffix}${ext}`)
  },
})

function fileFilter(_req: Request, file: Express.Multer.File, callback: multer.FileFilterCallback): void {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    callback(null, true)
  } else {
    callback(new Error(`File type ${file.mimetype} not allowed`))
  }
}

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 5, // Max 5 files per request
  },
  fileFilter,
})

export { MAX_FILE_SIZE, ALLOWED_MIME_TYPES }
