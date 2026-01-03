/**
 * API request/response types.
 *
 * These types define the contracts between frontend and backend.
 */

import type { StreamType, Visibility, CompanionMode, ContentFormat } from "./constants"
import type { Stream, StreamEvent, StreamMember, Workspace, WorkspaceMember, User, Persona } from "./domain"

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

export interface CreateMessageInput {
  streamId: string
  content: string
  contentFormat?: ContentFormat
  attachmentIds?: string[]
}

export interface UpdateMessageInput {
  content: string
}

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
  streams: Stream[]
  streamMemberships: StreamMember[]
  users: User[]
  personas: Persona[]
  emojis: EmojiEntry[]
  emojiWeights: Record<string, number>
  commands: CommandInfo[]
  unreadCounts: Record<string, number>
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
