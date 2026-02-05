/**
 * Wire types for domain entities.
 *
 * These types represent the JSON format sent over HTTP/WebSocket.
 * - Timestamps are ISO 8601 strings
 * - BigInt sequences are strings
 *
 * Backend serializes Date/BigInt to these formats before sending.
 * Frontend uses these types directly.
 */

import type {
  StreamType,
  Visibility,
  CompanionMode,
  AuthorType,
  EventType,
  WorkspaceMemberRole,
  PersonaManagedBy,
  PersonaStatus,
  StorageProvider,
  ProcessingStatus,
  ConversationStatus,
  MemoType,
  KnowledgeType,
  MemoStatus,
  PendingItemType,
  SourceType,
  ExtractionContentType,
  ExtractionSourceType,
  PdfSizeTier,
} from "./constants"
import type { ThreaDocument } from "./prosemirror"

export interface User {
  id: string
  email: string
  name: string
  slug: string
  workosUserId: string | null
  timezone: string | null
  locale: string | null
  createdAt: string
  updatedAt: string
}

export interface Workspace {
  id: string
  name: string
  slug: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface WorkspaceMember {
  workspaceId: string
  userId: string
  role: WorkspaceMemberRole
  joinedAt: string
}

export interface Stream {
  id: string
  workspaceId: string
  type: StreamType
  displayName: string | null
  slug: string | null
  description: string | null
  visibility: Visibility
  parentStreamId: string | null
  parentMessageId: string | null
  rootStreamId: string | null
  companionMode: CompanionMode
  companionPersonaId: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

/** Preview of the last message in a stream for sidebar display */
export interface LastMessagePreview {
  authorId: string
  authorType: AuthorType
  content: string
  createdAt: string
}

/** Stream with optional last message preview, for sidebar listing */
export interface StreamWithPreview extends Stream {
  lastMessagePreview: LastMessagePreview | null
}

export interface StreamMember {
  streamId: string
  userId: string
  pinned: boolean
  pinnedAt: string | null
  muted: boolean
  lastReadEventId: string | null
  lastReadAt: string | null
  joinedAt: string
}

export interface Message {
  id: string
  streamId: string
  sequence: string
  authorId: string
  authorType: AuthorType
  contentJson: ThreaDocument
  contentMarkdown: string
  replyCount: number
  reactions: Record<string, string[]>
  editedAt: string | null
  deletedAt: string | null
  createdAt: string
}

export interface StreamEvent {
  id: string
  streamId: string
  sequence: string
  eventType: EventType
  payload: unknown
  actorId: string | null
  actorType: AuthorType | null
  createdAt: string
}

export interface Persona {
  id: string
  workspaceId: string | null
  slug: string
  name: string
  description: string | null
  avatarEmoji: string | null
  systemPrompt: string | null
  model: string
  temperature: number | null
  maxTokens: number | null
  enabledTools: string[] | null
  managedBy: PersonaManagedBy
  status: PersonaStatus
  createdAt: string
  updatedAt: string
}

export interface Attachment {
  id: string
  workspaceId: string
  streamId: string | null
  messageId: string | null
  uploadedBy: string | null
  filename: string
  mimeType: string
  sizeBytes: number
  storageProvider: StorageProvider
  processingStatus: ProcessingStatus
  createdAt: string
}

/**
 * Lightweight attachment info included in message events.
 * Contains only what's needed for display; download URLs fetched on-demand.
 */
export interface AttachmentSummary {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
}

/**
 * Source reference for message citations.
 * Used by agents to provide sources for their responses.
 */
export interface SourceItem {
  /** Source type: web for external URLs, workspace for internal knowledge */
  type?: SourceType
  /** Display title of the source */
  title: string
  /** URL to the source (web URL or internal navigation link) */
  url: string
  /** Optional preview snippet of the source content */
  snippet?: string
}

export interface Conversation {
  id: string
  streamId: string
  workspaceId: string
  messageIds: string[]
  participantIds: string[]
  topicSummary: string | null
  completenessScore: number
  confidence: number
  status: ConversationStatus
  parentConversationId: string | null
  lastActivityAt: string
  createdAt: string
  updatedAt: string
}

/**
 * Conversation with computed temporal staleness.
 * Staleness is computed on read based on lastActivityAt.
 */
export interface ConversationWithStaleness extends Conversation {
  temporalStaleness: number
  effectiveCompleteness: number
}

/**
 * Memo: Semantic pointer to valuable knowledge.
 * Following GAM paper: lightweight abstracts that guide retrieval at runtime.
 */
export interface Memo {
  id: string
  workspaceId: string
  memoType: MemoType
  sourceMessageId: string | null
  sourceConversationId: string | null
  title: string
  abstract: string
  keyPoints: string[]
  sourceMessageIds: string[]
  participantIds: string[]
  knowledgeType: KnowledgeType
  tags: string[]
  parentMemoId: string | null
  status: MemoStatus
  version: number
  revisionReason: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

/**
 * Pending item in the memo processing queue.
 * Per-stream grouping for debounced batch processing.
 */
export interface PendingMemoItem {
  id: string
  workspaceId: string
  streamId: string
  itemType: PendingItemType
  itemId: string
  queuedAt: string
  processedAt: string | null
}

/**
 * Stream state for memo debounce logic.
 * Tracks last activity and processing times per stream.
 */
export interface MemoStreamState {
  workspaceId: string
  streamId: string
  lastProcessedAt: string | null
  lastActivityAt: string
}

/**
 * Structured data extracted from charts.
 * Fields use `| null` to match Zod schema output.
 */
export interface ChartData {
  chartType: string
  title: string | null
  axes: { x: string | null; y: string | null } | null
  dataPoints: Array<{ label: string; value: string | number }> | null
  trends: string[] | null
}

/**
 * Structured data extracted from tables.
 * Fields use `| null` to match Zod schema output.
 */
export interface TableData {
  headers: string[]
  rows: string[][]
  summary: string | null
}

/**
 * Structured data extracted from diagrams.
 * Fields use `| null` to match Zod schema output.
 */
export interface DiagramData {
  diagramType: string
  nodes: Array<{ id: string; label: string }> | null
  connections: Array<{ from: string; to: string; label: string | null }> | null
  description: string | null
}

/**
 * Section within a PDF document for large PDF navigation.
 */
export interface PdfSection {
  startPage: number
  endPage: number
  title: string
}

/**
 * Metadata for PDF extractions.
 */
export interface PdfMetadata {
  totalPages: number
  sizeTier: PdfSizeTier
  sections: PdfSection[]
}

/**
 * Extracted content from an attachment (images, documents, etc.).
 * Created by image captioning pipeline for AI agent context.
 */
export interface AttachmentExtraction {
  id: string
  attachmentId: string
  workspaceId: string
  contentType: ExtractionContentType
  summary: string
  fullText: string | null
  structuredData: ChartData | TableData | DiagramData | null
  sourceType: ExtractionSourceType
  pdfMetadata: PdfMetadata | null
  createdAt: string
  updatedAt: string
}
