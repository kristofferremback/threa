/**
 * Job queue types for the custom queue system.
 *
 * These types are used by QueueManager (queue-manager.ts) and all job workers.
 */

import { AgentTriggers } from "@threa/types"

/**
 * Job object passed to handlers.
 */
export interface Job<T = unknown> {
  id: string
  name: string
  data: T
}

// Job type definitions
export const JobQueues = {
  PERSONA_AGENT: "persona.agent",
  NAMING_GENERATE: "naming.generate",
  EMBEDDING_GENERATE: "embedding.generate",
  BOUNDARY_EXTRACT: "boundary.extract",
  MEMO_BATCH_CHECK: "memo.batch-check",
  MEMO_BATCH_PROCESS: "memo.batch-process",
  COMMAND_EXECUTE: "command.execute",
  IMAGE_CAPTION: "image.caption",
  PDF_PREPARE: "pdf.prepare",
  PDF_PROCESS_PAGE: "pdf.process_page",
  PDF_ASSEMBLE: "pdf.assemble",
  TEXT_PROCESS: "text.process",
  WORD_PROCESS: "word.process",
  EXCEL_PROCESS: "excel.process",
  AVATAR_PROCESS: "avatar.process",
} as const

export type JobQueueName = (typeof JobQueues)[keyof typeof JobQueues]

/** Unified persona agent job - handles both companion mode and @mention invocations */
export interface PersonaAgentJobData {
  workspaceId: string
  streamId: string // Where message was sent
  messageId: string // Trigger message
  personaId: string
  triggeredBy: string
  trigger?: typeof AgentTriggers.MENTION // undefined = companion mode
}

export interface NamingJobData {
  workspaceId: string
  streamId: string
  /** If true, must generate a name (no NOT_ENOUGH_CONTEXT escape). Set when message is from agent. */
  requireName: boolean
}

export interface EmbeddingJobData {
  messageId: string
  workspaceId: string
}

export interface BoundaryExtractionJobData {
  messageId: string
  streamId: string
  workspaceId: string
}

export interface MemoBatchCheckJobData {
  workspaceId: string // Use "system" for system-wide cron job
}

export interface MemoBatchProcessJobData {
  workspaceId: string
  streamId: string
}

export interface CommandExecuteJobData {
  commandId: string
  commandName: string
  args: string
  workspaceId: string
  streamId: string
  memberId: string
}

export interface ImageCaptionJobData {
  attachmentId: string
  workspaceId: string
  filename: string
  mimeType: string
  storagePath: string
}

/** PDF prepare job - extracts text/images, classifies pages, fans out page jobs */
export interface PdfPrepareJobData {
  attachmentId: string
  workspaceId: string
  filename: string
  storagePath: string
}

/** PDF page processing job - processes single page based on classification */
export interface PdfProcessPageJobData {
  attachmentId: string
  workspaceId: string
  pageNumber: number
  pdfJobId: string
}

/** PDF assemble job - combines page results into document extraction */
export interface PdfAssembleJobData {
  attachmentId: string
  workspaceId: string
  pdfJobId: string
}

/** Text processing job - processes text-based attachments */
export interface TextProcessJobData {
  attachmentId: string
  workspaceId: string
  filename: string
  storagePath: string
}

/** Word processing job - processes Word documents (.doc, .docx) */
export interface WordProcessJobData {
  attachmentId: string
  workspaceId: string
  filename: string
  storagePath: string
}

/** Excel processing job - processes Excel workbooks (.xlsx, .xls, .xlsm) */
export interface ExcelProcessJobData {
  attachmentId: string
  workspaceId: string
  filename: string
  storagePath: string
}

/** Avatar processing job - resizes raw upload into WebP variants */
export interface AvatarProcessJobData {
  workspaceId: string
  memberId: string
  rawS3Key: string
  oldAvatarUrl: string | null
}

// Map queue names to their data types
export interface JobDataMap {
  [JobQueues.PERSONA_AGENT]: PersonaAgentJobData
  [JobQueues.NAMING_GENERATE]: NamingJobData
  [JobQueues.EMBEDDING_GENERATE]: EmbeddingJobData
  [JobQueues.BOUNDARY_EXTRACT]: BoundaryExtractionJobData
  [JobQueues.MEMO_BATCH_CHECK]: MemoBatchCheckJobData
  [JobQueues.MEMO_BATCH_PROCESS]: MemoBatchProcessJobData
  [JobQueues.COMMAND_EXECUTE]: CommandExecuteJobData
  [JobQueues.IMAGE_CAPTION]: ImageCaptionJobData
  [JobQueues.PDF_PREPARE]: PdfPrepareJobData
  [JobQueues.PDF_PROCESS_PAGE]: PdfProcessPageJobData
  [JobQueues.PDF_ASSEMBLE]: PdfAssembleJobData
  [JobQueues.TEXT_PROCESS]: TextProcessJobData
  [JobQueues.WORD_PROCESS]: WordProcessJobData
  [JobQueues.EXCEL_PROCESS]: ExcelProcessJobData
  [JobQueues.AVATAR_PROCESS]: AvatarProcessJobData
}

/**
 * Handler for a single job. Returns void on success, throws on error.
 */
export type JobHandler<T> = (job: Job<T>) => Promise<void>

/**
 * Metadata about the queue message, available to DLQ hooks.
 */
export interface QueueMessageMeta {
  /** How many times the message failed before going to DLQ */
  failedCount: number
  /** When the message was originally enqueued */
  insertedAt: Date
  /** Workspace the message belongs to */
  workspaceId: string
}

/**
 * Hook called when a message is moved to DLQ.
 *
 * Runs in a savepoint within the DLQ transaction:
 * - Hook writes only persist if the DLQ move commits
 * - If the hook throws, only the hook's changes are rolled back
 * - The DLQ move still commits (hook failure doesn't brick the queue)
 *
 * Hooks should be idempotent since they may be retried on transient failures.
 */
export type OnDLQHook<T> = (
  querier: import("../../db").Querier,
  job: Job<T>,
  error: Error,
  meta: QueueMessageMeta
) => Promise<void>

/**
 * Lifecycle hooks for job handlers.
 */
export interface HandlerHooks<T> {
  /** Called when message is moved to DLQ after exhausting retries */
  onDLQ?: OnDLQHook<T>
}

/**
 * Options for registering a job handler.
 */
export interface HandlerOptions<T> {
  hooks?: HandlerHooks<T>
}
