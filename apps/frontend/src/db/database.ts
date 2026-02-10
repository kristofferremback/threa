import Dexie, { type EntityTable } from "dexie"
import type { AuthorType, EventType, JSONContent, StreamType } from "@threa/types"

// Cached entity types - mirror backend domain types

export interface CachedWorkspace {
  id: string
  name: string
  slug: string
  createdAt: string
  updatedAt: string
  _cachedAt: number
}

export interface CachedWorkspaceMember {
  id: string // member ID (member_xxx)
  workspaceId: string
  userId: string
  role: "owner" | "admin" | "member"
  slug: string
  timezone: string | null
  locale: string | null
  joinedAt: string
  _cachedAt: number
}

export interface CachedStream {
  id: string
  workspaceId: string
  type: StreamType
  displayName: string | null
  slug: string | null
  description: string | null
  visibility: "public" | "private"
  companionMode: "off" | "on"
  companionPersonaId: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  // User-specific state (from membership)
  pinned?: boolean
  muted?: boolean
  lastReadEventId?: string | null
  _cachedAt: number
}

export interface CachedEvent {
  id: string
  streamId: string
  sequence: string // bigint as string
  eventType: EventType
  payload: unknown
  actorId: string | null
  actorType: AuthorType | null
  createdAt: string
  // Optimistic sending state (for message_created events)
  _clientId?: string
  _status?: "pending" | "sent" | "failed"
  _cachedAt: number
}

export interface CachedUser {
  id: string
  email: string
  name: string
  _cachedAt: number
}

export interface CachedPersona {
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
  managedBy: "system" | "workspace"
  status: "pending" | "active" | "disabled" | "archived"
  createdAt: string
  updatedAt: string
  _cachedAt: number
}

export interface PendingMessage {
  clientId: string // ULID generated client-side
  workspaceId: string
  streamId: string
  content: string
  contentFormat: "markdown" | "plaintext"
  createdAt: number // timestamp for ordering
  retryCount: number
}

export interface SyncCursor {
  key: string // e.g., "workspace:xxx:streams" or "stream:xxx:events"
  cursor: string // Last synced ID/sequence
  updatedAt: number
}

export interface DraftScratchpad {
  id: string // draft_xxx format
  workspaceId: string
  displayName: string | null
  companionMode: "off" | "on"
  createdAt: number
}

/**
 * Attachment info stored in drafts. Subset of full Attachment - just display fields.
 */
export interface DraftAttachment {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
}

export interface DraftMessage {
  // Key format: "stream:{streamId}" or "thread:{parentMessageId}" for new threads
  id: string
  workspaceId: string
  /** ProseMirror JSON content */
  contentJson: JSONContent
  /** Attachments that have been uploaded and are ready to attach to the message */
  attachments?: DraftAttachment[]
  updatedAt: number
}

// Database class with typed tables
class ThreaDatabase extends Dexie {
  workspaces!: EntityTable<CachedWorkspace, "id">
  workspaceMembers!: EntityTable<CachedWorkspaceMember, "id">
  streams!: EntityTable<CachedStream, "id">
  events!: EntityTable<CachedEvent, "id">
  users!: EntityTable<CachedUser, "id">
  personas!: EntityTable<CachedPersona, "id">
  pendingMessages!: EntityTable<PendingMessage, "clientId">
  syncCursors!: EntityTable<SyncCursor, "key">
  draftScratchpads!: EntityTable<DraftScratchpad, "id">
  draftMessages!: EntityTable<DraftMessage, "id">

  constructor() {
    super("threa")

    this.version(1).stores({
      workspaces: "id, slug, _cachedAt",
      workspaceMembers: "id, workspaceId, userId, _cachedAt",
      streams: "id, workspaceId, type, [workspaceId+type], _cachedAt",
      events: "id, streamId, sequence, [streamId+sequence], eventType, _clientId, _cachedAt",
      users: "id, email, _cachedAt",
      pendingMessages: "clientId, streamId, createdAt",
      syncCursors: "key, updatedAt",
    })

    this.version(2).stores({
      draftScratchpads: "id, workspaceId, createdAt",
    })

    this.version(3).stores({
      draftMessages: "id, workspaceId, updatedAt",
    })

    this.version(4).stores({
      personas: "id, workspaceId, slug, _cachedAt",
    })

    this.version(5).stores({
      users: "id, email, slug, _cachedAt",
    })

    // v6: DraftMessage now stores contentJson (JSONContent) instead of content (string)
    // Clear existing drafts since converting markdown → JSON requires complex dependencies
    this.version(6)
      .stores({})
      .upgrade((tx) => {
        return tx.table("draftMessages").clear()
      })

    // v7: Member identity refactor — members now have their own ID, slug, timezone, locale.
    // Users no longer have slug. Clear workspace members cache to re-fetch with new shape.
    this.version(7)
      .stores({
        workspaceMembers: "id, workspaceId, userId, slug, _cachedAt",
        users: "id, email, _cachedAt",
      })
      .upgrade((tx) => {
        return Promise.all([tx.table("workspaceMembers").clear(), tx.table("users").clear()])
      })
  }
}

// Single database instance
export const db = new ThreaDatabase()

// Helper to clear all cached data (useful for logout)
export async function clearAllCachedData(): Promise<void> {
  await Promise.all([
    db.workspaces.clear(),
    db.workspaceMembers.clear(),
    db.streams.clear(),
    db.events.clear(),
    db.users.clear(),
    db.personas.clear(),
    db.syncCursors.clear(),
    // Note: we keep pendingMessages to retry sending after re-login
  ])
}

// Helper to clear pending messages (useful when explicitly canceling)
export async function clearPendingMessages(): Promise<void> {
  await db.pendingMessages.clear()
}
