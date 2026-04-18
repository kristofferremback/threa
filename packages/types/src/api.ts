/**
 * API request/response types.
 *
 * These types define the contracts between frontend and backend.
 */

import type { StreamType, Visibility, CompanionMode, SavedStatus, AuthorType } from "./constants"
import type { JSONContent } from "./prosemirror"
import type {
  Stream,
  StreamWithPreview,
  StreamEvent,
  StreamMember,
  Workspace,
  User,
  WorkspaceInvitation,
  Persona,
  Bot,
} from "./domain"
import type { UserPreferences } from "./preferences"

// ============================================================================
// Streams API
// ============================================================================

export interface CreateStreamInput {
  type: StreamType
  displayName?: string
  slug?: string
  description?: string
  visibility?: Visibility
  companionMode?: CompanionMode
  companionPersonaId?: string
  parentStreamId?: string
  parentMessageId?: string
  memberIds?: string[]
}

export interface UpdateStreamInput {
  displayName?: string
  slug?: string
  description?: string
  visibility?: Visibility
  companionMode?: CompanionMode
  companionPersonaId?: string
}

export interface UpdateCompanionModeInput {
  companionMode: CompanionMode
  companionPersonaId?: string | null
}

export interface StreamBootstrap {
  stream: Stream
  events: StreamEvent[]
  members: StreamMember[]
  membership: StreamMember | null
  latestSequence: string
  hasOlderEvents: boolean
  syncMode: "append" | "replace"
  unreadCount: number
  mentionCount: number
  activityCount: number
}

export interface EventsAroundResponse {
  events: StreamEvent[]
  hasOlder: boolean
  hasNewer: boolean
}

// ============================================================================
// Messages API
// ============================================================================

/**
 * JSON input format - used by rich clients sending ProseMirror JSON directly.
 */
export interface CreateMessageInputJson {
  streamId: string
  /** ProseMirror JSON content from TipTap editor */
  contentJson: JSONContent
  /** Optional pre-computed markdown (backend derives if missing) */
  contentMarkdown?: string
  attachmentIds?: string[]
  /** Client-generated idempotency key to prevent duplicate sends on retry */
  clientMessageId?: string
  /** External references as a flat string->string map. Keys under `threa.*` are reserved. */
  metadata?: Record<string, string>
}

export interface CreateDmMessageInputJson {
  dmUserId: string
  /** ProseMirror JSON content from TipTap editor */
  contentJson: JSONContent
  /** Optional pre-computed markdown (backend derives if missing) */
  contentMarkdown?: string
  attachmentIds?: string[]
  /** Client-generated idempotency key to prevent duplicate sends on retry */
  clientMessageId?: string
  /** External references as a flat string->string map. Keys under `threa.*` are reserved. */
  metadata?: Record<string, string>
}

/**
 * Markdown input format - used by AI agents, external integrators, CLI tools.
 */
export interface CreateMessageInputMarkdown {
  streamId: string
  /** Markdown text content */
  content: string
  attachmentIds?: string[]
  /** Client-generated idempotency key to prevent duplicate sends on retry */
  clientMessageId?: string
  /** External references as a flat string->string map. Keys under `threa.*` are reserved. */
  metadata?: Record<string, string>
}

export interface CreateDmMessageInputMarkdown {
  dmUserId: string
  /** Markdown text content */
  content: string
  attachmentIds?: string[]
  /** Client-generated idempotency key to prevent duplicate sends on retry */
  clientMessageId?: string
  /** External references as a flat string->string map. Keys under `threa.*` are reserved. */
  metadata?: Record<string, string>
}

/**
 * Union type - API accepts either JSON or Markdown input.
 * Backend detects format by presence of `contentJson` vs `content` field.
 */
export type CreateMessageInput = CreateMessageInputJson | CreateMessageInputMarkdown
export type CreateDmMessageInput = CreateDmMessageInputJson | CreateDmMessageInputMarkdown

/**
 * JSON input format for updates.
 */
export interface UpdateMessageInputJson {
  contentJson: JSONContent
  contentMarkdown?: string
}

/**
 * Markdown input format for updates.
 */
export interface UpdateMessageInputMarkdown {
  content: string
}

/**
 * Union type - API accepts either JSON or Markdown for updates.
 */
export type UpdateMessageInput = UpdateMessageInputJson | UpdateMessageInputMarkdown

// ============================================================================
// Workspaces API
// ============================================================================

export interface CreateWorkspaceInput {
  name: string
  slug?: string
  region?: string
}

export interface EmojiEntry {
  shortcode: string
  emoji: string
  type: "native" | "custom"
  group: string
  order: number
  /** All shortcodes including aliases (for search matching) */
  aliases: string[]
}

export interface CommandInfo {
  name: string
  description: string
}

export interface WorkspaceBootstrap {
  workspace: Workspace
  users: User[]
  streams: StreamWithPreview[]
  streamMemberships: StreamMember[]
  dmPeers: Array<{ userId: string; streamId: string }>
  personas: Persona[]
  bots: Bot[]
  emojis: EmojiEntry[]
  emojiWeights: Record<string, number>
  commands: CommandInfo[]
  unreadCounts: Record<string, number>
  mentionCounts: Record<string, number>
  activityCounts: Record<string, number>
  unreadActivityCount: number
  mutedStreamIds: string[]
  userPreferences: UserPreferences
  invitations?: WorkspaceInvitation[]
}

// ============================================================================
// Invitations API
// ============================================================================

export interface PendingInvitation {
  id: string
  workspaceId: string
  workspaceName: string
  expiresAt: string
}

export interface SendInvitationsInput {
  emails: string[]
  role?: "admin" | "user"
}

export type InvitationSkipReason = "already_user" | "pending_invitation"

export interface SendInvitationsResponse {
  sent: WorkspaceInvitation[]
  skipped: Array<{ email: string; reason: InvitationSkipReason }>
}

export interface CompleteUserSetupInput {
  name?: string
  slug?: string
  timezone: string
  locale: string
}

// ============================================================================
// Activity API
// ============================================================================

/** Wire format for activity items (dates as ISO strings) */
export interface Activity {
  id: string
  workspaceId: string
  userId: string
  activityType: string
  streamId: string
  messageId: string
  actorId: string
  actorType: string
  context: Record<string, unknown>
  readAt: string | null
  createdAt: string
  /**
   * True when this row represents the user's own action (e.g. a message they
   * sent or a reaction they added). Self rows appear in the feed but must not
   * inflate unread counts or trigger push notifications.
   */
  isSelf: boolean
  /** Populated for reaction activities; null otherwise. */
  emoji: string | null
}

/** Socket event payload for activity:created */
export interface ActivityCreatedPayload {
  workspaceId: string
  targetUserId: string
  activity: {
    id: string
    activityType: string
    streamId: string
    messageId: string
    actorId: string
    actorType: string
    context: Record<string, unknown>
    createdAt: string
    isSelf: boolean
  }
}

// ============================================================================
// Read State API
// ============================================================================

export interface MarkAsReadInput {
  lastEventId: string
}

export interface MarkAsReadResponse {
  membership: StreamMember
}

export interface MarkAllAsReadResponse {
  updatedStreamIds: string[]
}

// ============================================================================
// Commands API
// ============================================================================

export interface DispatchCommandInput {
  command: string
  streamId: string
}

export interface DispatchCommandResponse {
  success: true
  commandId: string
  command: string
  args: string
  event: StreamEvent
}

export interface DispatchCommandError {
  success: false
  error: string
  availableCommands?: string[]
}

export interface CommandDispatchedPayload {
  commandId: string
  name: string
  args: string
  status: "dispatched"
}

export interface CommandCompletedPayload {
  commandId: string
  result?: unknown
}

export interface CommandFailedPayload {
  commandId: string
  error: string
}

// ============================================================================
// AI Usage API
// ============================================================================

export interface AIUsageSummary {
  totalCostUsd: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  recordCount: number
}

export type AIUsageOrigin = "system" | "user"

export interface AIUsageByOrigin {
  origin: AIUsageOrigin
  totalCostUsd: number
  totalTokens: number
  recordCount: number
}

export interface AIUsageByUser {
  userId: string | null
  totalCostUsd: number
  totalTokens: number
  recordCount: number
}

export interface AIUsageRecord {
  id: string
  functionId: string
  model: string
  provider: string
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  costUsd: number
  userId: string | null
  sessionId: string | null
  createdAt: string
}

export interface AIUsageResponse {
  period: {
    start: string
    end: string
  }
  total: AIUsageSummary
  byOrigin: AIUsageByOrigin[]
  byUser: AIUsageByUser[]
}

export interface AIRecentUsageResponse {
  records: AIUsageRecord[]
}

export interface AIBudgetConfig {
  monthlyBudgetUsd: number
  alertThreshold50: boolean
  alertThreshold80: boolean
  alertThreshold100: boolean
  degradationEnabled: boolean
  hardLimitEnabled: boolean
  hardLimitPercent: number
}

export interface AIBudgetResponse {
  budget: AIBudgetConfig | null
  currentUsage: AIUsageSummary
  percentUsed: number
  nextReset: string
}

export interface UpdateAIBudgetInput {
  monthlyBudgetUsd?: number
  alertThreshold50?: boolean
  alertThreshold80?: boolean
  alertThreshold100?: boolean
  degradationEnabled?: boolean
  hardLimitEnabled?: boolean
  hardLimitPercent?: number
}

// ============================================================================
// Push Notifications API
// ============================================================================

/**
 * Length of the hex-encoded device key prefix used to correlate push subscriptions with sessions.
 *
 * Algorithm contract (must match in both frontend and backend implementations):
 *   1. Input: navigator.userAgent string
 *   2. Hash: SHA-256
 *   3. Encode: hex
 *   4. Slice: first DEVICE_KEY_LENGTH characters
 *
 * Implementations: frontend `getDeviceKey` (use-push-notifications.ts), backend `deriveDeviceKey` (socket.ts).
 */
export const DEVICE_KEY_LENGTH = 16

// ============================================================================
// Saved Messages API
// ============================================================================

/**
 * Wire shape for a saved-message row. Absolute timestamps are ISO strings; the
 * live-resolved message snapshot is null when the underlying message has been
 * deleted or the owner has lost access to the stream.
 */
export interface SavedMessageView {
  id: string
  workspaceId: string
  userId: string
  messageId: string
  streamId: string
  status: SavedStatus
  remindAt: string | null
  reminderSentAt: string | null
  savedAt: string
  statusChangedAt: string
  message: SavedMessageSnapshot | null
  unavailableReason: "deleted" | "access_lost" | null
}

export interface SavedMessageSnapshot {
  authorId: string
  authorType: AuthorType
  contentJson: JSONContent
  contentMarkdown: string
  createdAt: string
  editedAt: string | null
  streamName: string | null
}

export interface SaveMessageInput {
  messageId: string
  remindAt?: string | null
}

export interface UpdateSavedMessageInput {
  status?: SavedStatus
  remindAt?: string | null
}

export interface SavedMessageListResponse {
  saved: SavedMessageView[]
  nextCursor: string | null
}

/** Wire payload broadcast on `saved:upserted` socket events. */
export interface SavedUpsertedPayload {
  workspaceId: string
  targetUserId: string
  saved: SavedMessageView
}

/** Wire payload broadcast on `saved:deleted` socket events. */
export interface SavedDeletedPayload {
  workspaceId: string
  targetUserId: string
  savedId: string
  messageId: string
}

/** Wire payload broadcast on `saved_reminder:fired` socket events. */
export interface SavedReminderFiredPayload {
  workspaceId: string
  targetUserId: string
  savedId: string
  messageId: string
  streamId: string
  saved: SavedMessageView
}
