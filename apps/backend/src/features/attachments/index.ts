// Repositories
export { AttachmentRepository } from "./repository"
export type { Attachment, InsertAttachmentParams, AttachmentWithExtraction } from "./repository"

export { AttachmentExtractionRepository } from "./extraction-repository"
export type {
  AttachmentExtraction,
  InsertAttachmentExtractionParams,
  PdfMetadata,
  PdfSection,
} from "./extraction-repository"

export { PdfPageExtractionRepository } from "./pdf/page-extraction-repository"
export type {
  PdfPageExtraction,
  EmbeddedImage,
  InsertPdfPageExtractionParams,
  UpdatePdfPageExtractionParams,
} from "./pdf/page-extraction-repository"

export { PdfProcessingJobRepository } from "./pdf/job-repository"
export type { PdfProcessingJob, InsertPdfProcessingJobParams } from "./pdf/job-repository"

// Service
export { AttachmentService } from "./service"
export type { CreateAttachmentParams } from "./service"

// Handlers
export { createAttachmentHandlers } from "./handlers"

// Outbox handler
export { AttachmentUploadedHandler } from "./uploaded-outbox-handler"

// Await processing
export { awaitAttachmentProcessing, hasPendingAttachmentProcessing } from "./await-processing"
export type { AwaitAttachmentProcessingResult } from "./await-processing"

// Upload safety policy
export {
  createAttachmentSafetyPolicy,
  createMalwareScanner,
  isMimeTypeAllowed,
  isAttachmentSafeForSharing,
  safetyStatusBlockReason,
} from "./upload-safety-policy"
export type {
  AttachmentSafetyPolicy,
  MalwareScanner,
  MalwareScanInput,
  MalwareScanResult,
} from "./upload-safety-policy"

// Sub-feature re-exports
export { ImageCaptionService, StubImageCaptionService, isImageAttachment } from "./image-caption"
export type { ImageCaptionServiceDeps, ImageCaptionServiceLike } from "./image-caption"

export { PdfProcessingService, StubPdfProcessingService, isPdfAttachment } from "./pdf"
export type { PdfProcessingServiceLike, PdfProcessingServiceDeps } from "./pdf"

export { TextProcessingService, StubTextProcessingService } from "./text"
export type { TextProcessingServiceDeps, TextProcessingServiceLike } from "./text"

export { WordProcessingService, StubWordProcessingService, isWordAttachment } from "./word"
export type { WordProcessingServiceDeps, WordProcessingServiceLike } from "./word"

export {
  ExcelProcessingService,
  StubExcelProcessingService,
  isExcelAttachment,
  EXCEL_MAX_ROWS_PER_REQUEST,
} from "./excel"
export type { ExcelProcessingServiceDeps, ExcelProcessingServiceLike } from "./excel"

// Workers
export { createImageCaptionWorker } from "./image-caption/worker"
export { createPdfPrepareWorker } from "./pdf/prepare-worker"
export { createPdfPageWorker } from "./pdf/page-worker"
export { createPdfAssembleWorker } from "./pdf/assemble-worker"
export { createTextProcessingWorker } from "./text/worker"
export { createWordProcessingWorker } from "./word/worker"
export { createExcelProcessingWorker } from "./excel/worker"
