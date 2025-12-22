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
  ContentFormat,
  AuthorType,
  EventType,
  WorkspaceMemberRole,
  PersonaManagedBy,
  PersonaStatus,
  StorageProvider,
  ProcessingStatus,
} from "./constants"

export interface User {
  id: string
  email: string
  name: string
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
  content: string
  contentFormat: ContentFormat
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
  streamId: string
  messageId: string | null
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
