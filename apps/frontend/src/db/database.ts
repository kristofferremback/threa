import Dexie, { type EntityTable } from "dexie"
import type { AuthorType, CompanionMode, EventType, JSONContent, NotificationLevel, StreamType } from "@threa/types"

const WORKSPACE_USERS_STORE = "workspaceUsers"
const LEGACY_WORKSPACE_USERS_STORE = "workspaceMembers"

// Cached entity types - mirror backend domain types

export interface CachedWorkspace {
  id: string
  name: string
  slug: string
  createdAt: string
  updatedAt: string
  _cachedAt: number
}

export interface CachedWorkspaceUser {
  id: string // workspace user ID (legacy prefix: member_xxx)
  workspaceId: string
  workosUserId: string
  email: string
  role: "owner" | "admin" | "user"
  slug: string
  name: string
  description: string | null
  avatarUrl: string | null
  timezone: string | null
  locale: string | null
  pronouns: string | null
  phone: string | null
  githubUsername: string | null
  setupCompleted: boolean
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
  parentStreamId: string | null
  parentMessageId: string | null
  rootStreamId: string | null
  companionMode: "off" | "on"
  companionPersonaId: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  // Sidebar preview (from workspace bootstrap StreamWithPreview)
  lastMessagePreview?: { authorId: string; authorType: AuthorType; content: string; createdAt: string } | null
  // User-specific state (from membership)
  pinned?: boolean
  notificationLevel?: string | null
  lastReadEventId?: string | null
  _cachedAt: number
}

export interface CachedStreamMembership {
  /** Composite key: `${workspaceId}:${streamId}` */
  id: string
  workspaceId: string
  streamId: string
  memberId: string
  pinned: boolean
  pinnedAt: string | null
  notificationLevel: NotificationLevel | null
  lastReadEventId: string | null
  lastReadAt: string | null
  joinedAt: string
  _cachedAt: number
}

export interface CachedDmPeer {
  /** Composite key: `${workspaceId}:${streamId}` */
  id: string
  workspaceId: string
  userId: string
  streamId: string
  _cachedAt: number
}

export interface CachedEvent {
  id: string
  workspaceId: string
  streamId: string
  sequence: string // bigint as string
  /** Numeric mirror of sequence for IDB index ordering (string indexes sort lexicographically). */
  _sequenceNum: number
  eventType: EventType
  payload: unknown
  actorId: string | null
  actorType: AuthorType | null
  createdAt: string
  // Optimistic sending state (for message_created events)
  _clientId?: string
  _status?: "pending" | "sent" | "failed" | "editing"
  _cachedAt: number
}

/**
 * Convert a sequence string to a number for IDB indexing.
 * Sequences fit well within Number.MAX_SAFE_INTEGER for practical use.
 */
export function sequenceToNum(sequence: string): number {
  return Number(sequence)
}

export interface CachedBot {
  id: string
  workspaceId: string
  slug: string | null
  name: string
  description: string | null
  avatarEmoji: string | null
  avatarUrl: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
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

export interface PendingStreamCreation {
  type: StreamType
  displayName?: string
  companionMode?: CompanionMode
  parentStreamId?: string
  parentMessageId?: string
}

export interface PendingMessage {
  clientId: string // ULID generated client-side
  workspaceId: string
  streamId: string
  content: string
  contentFormat: "markdown" | "plaintext"
  /** ProseMirror JSON content for sending to the API */
  contentJson?: JSONContent
  /** Attachment IDs to include with the message */
  attachmentIds?: string[]
  createdAt: number // timestamp for ordering
  retryCount: number
  /** Timestamp before which this message should not be retried (exponential backoff) */
  retryAfter?: number
  /** When "editing", the queue skips this message so it isn't sent while the user edits it */
  status?: "editing"
  /** Original queue state before entering editing mode; used to cancel stale edits on startup. */
  preEditStatus?: "pending" | "failed"
  /** When set, the queue creates this stream before sending the message */
  streamCreation?: PendingStreamCreation
  /** The draft ID to clean up after successful stream creation + message send */
  draftId?: string
  /** Set by the queue after stream creation succeeds — prevents duplicate creation on retry */
  promotedStreamId?: string
}

/**
 * Generic offline operation queue for non-message writes (edits, deletes, reactions).
 * Operations are retried when back online, similar to PendingMessage for sends.
 */
export interface PendingOperation {
  id: string // ULID
  workspaceId: string
  type: "edit_message" | "delete_message" | "add_reaction" | "remove_reaction"
  payload: Record<string, unknown>
  createdAt: number
  retryCount: number
  retryAfter?: number
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

export interface CachedUnreadState {
  id: string // workspaceId
  workspaceId: string
  unreadCounts: Record<string, number>
  mentionCounts: Record<string, number>
  activityCounts: Record<string, number>
  unreadActivityCount: number
  mutedStreamIds: string[]
  _cachedAt: number
}

export interface CachedUserPreferences {
  id: string // workspaceId
  workspaceId: string
  userId: string
  theme: string
  sendMode: string
  [key: string]: unknown
  _cachedAt: number
}

/**
 * Persisted UI toggle state for a single code block inside a message.
 * Scoped per message so collapsed/expanded state survives reloads.
 * Key format: `${messageId}:${blockIndex}` — blockIndex is the 0-based
 * position of the fenced code block within the message's markdown.
 */
export interface CachedCodeBlockCollapse {
  id: string
  messageId: string
  blockIndex: number
  collapsed: boolean
  updatedAt: number
}

export interface CachedWorkspaceMetadata {
  id: string // workspaceId
  workspaceId: string
  emojis: Array<{ shortcode: string; emoji: string; type: string; group: string; order: number; aliases: string[] }>
  emojiWeights: Record<string, number>
  commands: Array<{ name: string; description: string }>
  _cachedAt: number
}

// Database class with typed tables
class ThreaDatabase extends Dexie {
  workspaces!: EntityTable<CachedWorkspace, "id">
  workspaceUsers!: EntityTable<CachedWorkspaceUser, "id">
  streams!: EntityTable<CachedStream, "id">
  streamMemberships!: EntityTable<CachedStreamMembership, "id">
  dmPeers!: EntityTable<CachedDmPeer, "id">
  events!: EntityTable<CachedEvent, "id">
  personas!: EntityTable<CachedPersona, "id">
  bots!: EntityTable<CachedBot, "id">
  pendingMessages!: EntityTable<PendingMessage, "clientId">
  syncCursors!: EntityTable<SyncCursor, "key">
  draftScratchpads!: EntityTable<DraftScratchpad, "id">
  draftMessages!: EntityTable<DraftMessage, "id">
  unreadState!: EntityTable<CachedUnreadState, "id">
  userPreferences!: EntityTable<CachedUserPreferences, "id">
  workspaceMetadata!: EntityTable<CachedWorkspaceMetadata, "id">
  pendingOperations!: EntityTable<PendingOperation, "id">
  codeBlockCollapse!: EntityTable<CachedCodeBlockCollapse, "id">

  constructor() {
    super("threa")

    this.version(1).stores({
      workspaces: "id, slug, _cachedAt",
      [LEGACY_WORKSPACE_USERS_STORE]: "id, workspaceId, userId, _cachedAt",
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

    // v7: Workspace user identity refactor — users now have their own ID, slug, timezone, locale.
    // Global users cache no longer has slug. Clear workspace user cache to re-fetch with new shape.
    this.version(7)
      .stores({
        [LEGACY_WORKSPACE_USERS_STORE]: "id, workspaceId, userId, slug, _cachedAt",
        users: "id, email, _cachedAt",
      })
      .upgrade((tx) => {
        return Promise.all([tx.table(LEGACY_WORKSPACE_USERS_STORE).clear(), tx.table("users").clear()])
      })

    // v8: Added setupCompleted to workspace users for invitation flow.
    // Clear workspace user cache to re-fetch with new shape.
    this.version(8)
      .stores({})
      .upgrade((tx) => {
        return tx.table(LEGACY_WORKSPACE_USERS_STORE).clear()
      })

    // v9: Added name to workspace users (workspace-scoped display name).
    // Clear workspace user cache to re-fetch with new shape.
    this.version(9)
      .stores({})
      .upgrade((tx) => {
        return tx.table(LEGACY_WORKSPACE_USERS_STORE).clear()
      })

    // v10: Added description and avatarUrl to workspace users (profile fields).
    // Clear workspace user cache to re-fetch with new shape.
    this.version(10)
      .stores({})
      .upgrade((tx) => {
        return tx.table(LEGACY_WORKSPACE_USERS_STORE).clear()
      })

    // v11: Remove cached global users table and move WorkOS identity/email onto workspace users.
    this.version(11)
      .stores({
        [LEGACY_WORKSPACE_USERS_STORE]: "id, workspaceId, workosUserId, email, slug, _cachedAt",
        users: null,
      })
      .upgrade((tx) => {
        return tx.table(LEGACY_WORKSPACE_USERS_STORE).clear()
      })

    // v12: Rename local cache store from workspaceMembers -> workspaceUsers.
    // We intentionally reset cache during this rename; bootstrap refetch repopulates it.
    this.version(12)
      .stores({
        [WORKSPACE_USERS_STORE]: "id, workspaceId, workosUserId, email, slug, _cachedAt",
        [LEGACY_WORKSPACE_USERS_STORE]: null,
      })
      .upgrade((tx) => tx.table(WORKSPACE_USERS_STORE).clear())

    // v13: Cache stream memberships and DM peers for offline seed.
    // Also adds parentStreamId/rootStreamId/archivedAt to CachedStream (already stored
    // via spread, but now typed and relied upon by cache-seed).
    this.version(13).stores({
      streamMemberships: "id, workspaceId, streamId, _cachedAt",
      dmPeers: "id, workspaceId, streamId, _cachedAt",
    })

    // v14: Add bots table for bot entity resolution on frontend.
    this.version(14).stores({
      bots: "id, workspaceId, _cachedAt",
    })

    // v15: Add unreadState and userPreferences tables for offline-first sync engine.
    // These tables hold workspace-scoped data that was previously only in TanStack Query
    // cache (embedded in WorkspaceBootstrap). Persisting them enables offline rendering.
    this.version(15).stores({
      unreadState: "id, workspaceId",
      userPreferences: "id, workspaceId",
    })

    // v16: Add workspaceId to events table for workspace-scoped cleanup and leak prevention.
    // Clear existing events since they lack workspaceId; bootstrap refetch repopulates.
    this.version(16)
      .stores({
        events: "id, workspaceId, streamId, sequence, [streamId+sequence], eventType, _clientId, _cachedAt",
      })
      .upgrade((tx) => tx.table("events").clear())

    // v17: Add workspaceMetadata table for emojis, emojiWeights, and commands.
    this.version(17).stores({
      workspaceMetadata: "id, workspaceId",
    })

    // v18: Add pendingOperations table for offline-queued writes (edits, deletes, reactions).
    this.version(18).stores({
      pendingOperations: "id, workspaceId, type, createdAt",
    })

    // v19: Add [streamId+eventType] compound index for scoped event lookups
    // (reactions, edits, deletes scan only message_created events instead of
    // all events in a stream). Add _status index so pending/failed message
    // hydration uses an index scan instead of a full table cursor.
    this.version(19).stores({
      events:
        "id, workspaceId, streamId, sequence, [streamId+sequence], eventType, [streamId+eventType], _clientId, _cachedAt, _status",
    })

    // v20: Add _sequenceNum (numeric mirror of sequence) and compound index
    // [streamId+_sequenceNum] so IDB can sort events numerically for efficient
    // "most recent N" queries. Clear events so bootstrap re-populates them
    // with the new field.
    this.version(20)
      .stores({
        events:
          "id, workspaceId, streamId, sequence, [streamId+sequence], [streamId+_sequenceNum], eventType, [streamId+eventType], _clientId, _cachedAt, _status",
      })
      .upgrade((tx) => tx.table("events").clear())

    // v21: Add codeBlockCollapse table for per-message, per-code-block collapse
    // toggle state. Indexed by messageId so we can bulk-clear a message's
    // state when it is deleted.
    this.version(21).stores({
      codeBlockCollapse: "id, messageId, updatedAt",
    })

    this.workspaceUsers = this.table(WORKSPACE_USERS_STORE) as EntityTable<CachedWorkspaceUser, "id">
  }
}

// Single database instance
export const db = new ThreaDatabase()

// Helper to clear all cached data (useful for logout)
export async function clearAllCachedData(): Promise<void> {
  try {
    await Promise.all([
      db.workspaces.clear(),
      db.workspaceUsers.clear(),
      db.streams.clear(),
      db.streamMemberships.clear(),
      db.dmPeers.clear(),
      db.events.clear(),
      db.personas.clear(),
      db.bots.clear(),
      db.syncCursors.clear(),
      db.unreadState.clear(),
      db.userPreferences.clear(),
      db.workspaceMetadata.clear(),
      db.pendingOperations.clear(),
      db.codeBlockCollapse.clear(),
      // Note: we keep pendingMessages to retry sending after re-login
    ])
  } finally {
    const [{ resetWorkspaceStoreCache }, { resetStreamStoreCache }, { resetDraftStoreCache }] = await Promise.all([
      import("@/stores/workspace-store"),
      import("@/stores/stream-store"),
      import("@/stores/draft-store"),
    ])
    resetWorkspaceStoreCache()
    resetStreamStoreCache()
    resetDraftStoreCache()
  }
}

// Helper to clear pending messages (useful when explicitly canceling)
export async function clearPendingMessages(): Promise<void> {
  await db.pendingMessages.clear()
}
