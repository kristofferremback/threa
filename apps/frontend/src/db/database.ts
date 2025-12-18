import Dexie, { type EntityTable } from "dexie"

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
  id: string // composite: `${workspaceId}:${userId}`
  workspaceId: string
  userId: string
  role: "owner" | "admin" | "member"
  joinedAt: string
  _cachedAt: number
}

export interface CachedStream {
  id: string
  workspaceId: string
  type: "scratchpad" | "channel" | "dm" | "thread"
  displayName: string | null
  slug: string | null
  description: string | null
  visibility: "public" | "private"
  companionMode: "off" | "on" | "next_message_only"
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

export type EventType =
  | "message_created"
  | "message_edited"
  | "message_deleted"
  | "reaction_added"
  | "reaction_removed"
  | "member_joined"
  | "member_left"
  | "thread_created"
  | "companion_response"

export interface CachedEvent {
  id: string
  streamId: string
  sequence: string // bigint as string
  eventType: EventType
  payload: unknown
  actorId: string | null
  actorType: "user" | "persona" | null
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
  companionMode: "off" | "on" | "next_message_only"
  createdAt: number
}

export interface DraftMessage {
  // Key format: "stream:{streamId}" or "thread:{parentMessageId}" for new threads
  id: string
  workspaceId: string
  content: string
  updatedAt: number
}

// Database class with typed tables
class ThreaDatabase extends Dexie {
  workspaces!: EntityTable<CachedWorkspace, "id">
  workspaceMembers!: EntityTable<CachedWorkspaceMember, "id">
  streams!: EntityTable<CachedStream, "id">
  events!: EntityTable<CachedEvent, "id">
  users!: EntityTable<CachedUser, "id">
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
    db.syncCursors.clear(),
    // Note: we keep pendingMessages to retry sending after re-login
  ])
}

// Helper to clear pending messages (useful when explicitly canceling)
export async function clearPendingMessages(): Promise<void> {
  await db.pendingMessages.clear()
}
