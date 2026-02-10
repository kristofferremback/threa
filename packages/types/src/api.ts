/**
 * API request/response types.
 *
 * These types define the contracts between frontend and backend.
 */

import type { StreamType, Visibility, CompanionMode } from "./constants"
import type { JSONContent } from "./prosemirror"
import type {
  Stream,
  StreamWithPreview,
  StreamEvent,
  StreamMember,
  Workspace,
  WorkspaceMember,
  WorkspaceInvitation,
  User,
  Persona,
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
}

export interface UpdateStreamInput {
  displayName?: string
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
}

/**
 * Markdown input format - used by AI agents, external integrators, CLI tools.
 */
export interface CreateMessageInputMarkdown {
  streamId: string
  /** Markdown text content */
  content: string
  attachmentIds?: string[]
}

/**
 * Union type - API accepts either JSON or Markdown input.
 * Backend detects format by presence of `contentJson` vs `content` field.
 */
export type CreateMessageInput = CreateMessageInputJson | CreateMessageInputMarkdown

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
  members: WorkspaceMember[]
  streams: StreamWithPreview[]
  streamMemberships: StreamMember[]
  users: User[]
  personas: Persona[]
  emojis: EmojiEntry[]
  emojiWeights: Record<string, number>
  commands: CommandInfo[]
  unreadCounts: Record<string, number>
  userPreferences: UserPreferences
  invitations?: WorkspaceInvitation[]
}

// ============================================================================
// Invitations API
// ============================================================================

export interface SendInvitationsInput {
  emails: string[]
  role?: "admin" | "member"
}

export interface SendInvitationsResponse {
  sent: WorkspaceInvitation[]
  skipped: Array<{ email: string; reason: string }>
}

export interface CompleteMemberSetupInput {
  name?: string
  slug?: string
  timezone: string
  locale: string
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

export interface AIUsageByMember {
  memberId: string | null
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
  memberId: string | null
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
  byMember: AIUsageByMember[]
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
