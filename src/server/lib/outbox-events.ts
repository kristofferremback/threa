/**
 * Outbox Event Types and Publisher
 *
 * This module centralizes all real-time event publishing for the application.
 * EVERY database mutation that should trigger a UI update MUST publish an event here.
 *
 * Event Flow:
 * 1. Service performs DB mutation in a transaction
 * 2. Service calls OutboxPublisher.publish() within the same transaction
 * 3. OutboxListener picks up the event and publishes to Redis
 * 4. Socket.IO server broadcasts to connected clients
 * 5. Frontend hooks receive and update UI state
 *
 * ADDING NEW EVENTS:
 * 1. Add the event type to OutboxEventType
 * 2. Add the payload interface
 * 3. Add to OutboxEventPayloads union
 * 4. Handle in stream-socket.ts messageSubscriber.on("message", ...)
 * 5. Handle in frontend hooks (useWorkspaceSocket, useStream, useBootstrap)
 */

import type { PoolClient } from "pg"
import { sql } from "./db"
import { generateId } from "./id"

// ============================================================================
// Event Types - All events that can be published
// ============================================================================

export const OutboxEventType = {
  // Stream Events (messages, edits, deletes)
  STREAM_EVENT_CREATED: "stream_event.created",
  STREAM_EVENT_EDITED: "stream_event.edited",
  STREAM_EVENT_DELETED: "stream_event.deleted",

  // Stream Lifecycle
  STREAM_CREATED: "stream.created",
  STREAM_UPDATED: "stream.updated",
  STREAM_ARCHIVED: "stream.archived",
  STREAM_PROMOTED: "stream.promoted",

  // Stream Membership
  STREAM_MEMBER_ADDED: "stream.member_added",
  STREAM_MEMBER_REMOVED: "stream.member_removed",

  // Workspace Membership
  WORKSPACE_MEMBER_ADDED: "workspace.member_added",
  WORKSPACE_MEMBER_REMOVED: "workspace.member_removed",
  WORKSPACE_MEMBER_UPDATED: "workspace.member_updated",

  // User Profile
  USER_PROFILE_UPDATED: "user.profile_updated",

  // Invitations
  INVITATION_CREATED: "invitation.created",
  INVITATION_ACCEPTED: "invitation.accepted",
  INVITATION_REVOKED: "invitation.revoked",

  // Notifications
  NOTIFICATION_CREATED: "notification.created",

  // Read State
  READ_CURSOR_UPDATED: "read_cursor.updated",
} as const

export type OutboxEventType = (typeof OutboxEventType)[keyof typeof OutboxEventType]

// ============================================================================
// Event Payloads - Type-safe payloads for each event
// ============================================================================

// --- Stream Events ---

export interface StreamEventCreatedPayload {
  event_id: string
  stream_id: string
  workspace_id: string
  stream_slug?: string
  stream_type?: string
  event_type: string
  actor_id?: string
  agent_id?: string
  content?: string
  mentions?: Array<{ type: string; id: string; label?: string }>
  is_crosspost?: boolean
  original_stream_id?: string
}

export interface StreamEventEditedPayload {
  event_id: string
  stream_id: string
  workspace_id: string
  content: string
  edited_at: string
}

export interface StreamEventDeletedPayload {
  event_id: string
  stream_id: string
  workspace_id: string
}

// --- Stream Lifecycle ---

export interface StreamCreatedPayload {
  stream_id: string
  workspace_id: string
  stream_type: "channel" | "thread" | "dm" | "incident" | "thinking_space"
  name?: string | null
  slug?: string | null
  visibility: "public" | "private" | "inherit"
  creator_id: string
  parent_stream_id?: string | null
  branched_from_event_id?: string | null
  participant_ids?: string[] // For DMs
}

export interface StreamUpdatedPayload {
  stream_id: string
  workspace_id: string
  name?: string | null
  slug?: string | null
  description?: string | null
  topic?: string | null
  updated_by: string
}

export interface StreamArchivedPayload {
  stream_id: string
  workspace_id: string
  archived: boolean
  archived_by: string
}

export interface StreamPromotedPayload {
  stream_id: string
  workspace_id: string
  new_type: "channel" | "incident"
  new_name: string
  new_slug: string
  promoted_by: string
}

// --- Stream Membership ---

export interface StreamMemberAddedPayload {
  stream_id: string
  stream_name: string
  stream_slug?: string | null
  workspace_id: string
  user_id: string
  added_by_user_id?: string
  role: string
}

export interface StreamMemberRemovedPayload {
  stream_id: string
  stream_name: string
  workspace_id: string
  user_id: string
  removed_by_user_id?: string
}

// --- Workspace Membership ---

export interface WorkspaceMemberAddedPayload {
  workspace_id: string
  user_id: string
  user_email: string
  user_name?: string | null
  role: string
  added_by_user_id?: string
}

export interface WorkspaceMemberRemovedPayload {
  workspace_id: string
  user_id: string
  user_email: string
  removed_by_user_id?: string
}

export interface WorkspaceMemberUpdatedPayload {
  workspace_id: string
  user_id: string
  role?: string
  status?: string
  updated_by_user_id?: string
}

// --- User Profile ---

export interface UserProfileUpdatedPayload {
  workspace_id: string
  user_id: string
  display_name?: string | null
  title?: string | null
  avatar_url?: string | null
}

// --- Invitations ---

export interface InvitationCreatedPayload {
  invitation_id: string
  workspace_id: string
  email: string
  role: string
  invited_by_user_id: string
  invited_by_email: string
  expires_at: string
}

export interface InvitationAcceptedPayload {
  invitation_id: string
  workspace_id: string
  user_id: string
  user_email: string
  user_name?: string | null
  role: string
}

export interface InvitationRevokedPayload {
  invitation_id: string
  workspace_id: string
  email: string
  revoked_by_user_id: string
}

// --- Notifications ---

export interface NotificationCreatedPayload {
  id: string
  workspace_id: string
  user_id: string
  notification_type: string
  stream_id?: string
  stream_name?: string
  stream_slug?: string
  event_id?: string
  actor_id?: string
  actor_email?: string
  actor_name?: string
  preview?: string
}

// --- Read State ---

export interface ReadCursorUpdatedPayload {
  stream_id: string
  workspace_id: string
  user_id: string
  event_id: string
}

// ============================================================================
// Payload Type Map - Maps event types to their payloads
// ============================================================================

export interface OutboxPayloadMap {
  [OutboxEventType.STREAM_EVENT_CREATED]: StreamEventCreatedPayload
  [OutboxEventType.STREAM_EVENT_EDITED]: StreamEventEditedPayload
  [OutboxEventType.STREAM_EVENT_DELETED]: StreamEventDeletedPayload
  [OutboxEventType.STREAM_CREATED]: StreamCreatedPayload
  [OutboxEventType.STREAM_UPDATED]: StreamUpdatedPayload
  [OutboxEventType.STREAM_ARCHIVED]: StreamArchivedPayload
  [OutboxEventType.STREAM_PROMOTED]: StreamPromotedPayload
  [OutboxEventType.STREAM_MEMBER_ADDED]: StreamMemberAddedPayload
  [OutboxEventType.STREAM_MEMBER_REMOVED]: StreamMemberRemovedPayload
  [OutboxEventType.WORKSPACE_MEMBER_ADDED]: WorkspaceMemberAddedPayload
  [OutboxEventType.WORKSPACE_MEMBER_REMOVED]: WorkspaceMemberRemovedPayload
  [OutboxEventType.WORKSPACE_MEMBER_UPDATED]: WorkspaceMemberUpdatedPayload
  [OutboxEventType.USER_PROFILE_UPDATED]: UserProfileUpdatedPayload
  [OutboxEventType.INVITATION_CREATED]: InvitationCreatedPayload
  [OutboxEventType.INVITATION_ACCEPTED]: InvitationAcceptedPayload
  [OutboxEventType.INVITATION_REVOKED]: InvitationRevokedPayload
  [OutboxEventType.NOTIFICATION_CREATED]: NotificationCreatedPayload
  [OutboxEventType.READ_CURSOR_UPDATED]: ReadCursorUpdatedPayload
}

// ============================================================================
// Outbox Publisher - Centralized event publishing
// ============================================================================

/**
 * Publish an event to the outbox table.
 * MUST be called within a database transaction to ensure atomicity.
 *
 * @param client - The database client (must be in a transaction)
 * @param eventType - The type of event (use OutboxEventType constants)
 * @param payload - The event payload (type-checked based on eventType)
 */
export async function publishOutboxEvent<T extends OutboxEventType>(
  client: PoolClient,
  eventType: T,
  payload: OutboxPayloadMap[T],
): Promise<string> {
  const outboxId = generateId("outbox")

  await client.query(
    sql`INSERT INTO outbox (id, event_type, payload)
        VALUES (${outboxId}, ${eventType}, ${JSON.stringify(payload)})`,
  )

  // Notify the outbox listener
  await client.query(`NOTIFY outbox_event, '${outboxId.replace(/'/g, "''")}'`)

  return outboxId
}

/**
 * Helper to publish multiple events in a batch.
 * All events will be published in the same transaction.
 */
export async function publishOutboxEvents(
  client: PoolClient,
  events: Array<{ eventType: OutboxEventType; payload: OutboxPayloadMap[OutboxEventType] }>,
): Promise<string[]> {
  const outboxIds: string[] = []

  for (const { eventType, payload } of events) {
    const outboxId = generateId("outbox")
    await client.query(
      sql`INSERT INTO outbox (id, event_type, payload)
          VALUES (${outboxId}, ${eventType}, ${JSON.stringify(payload)})`,
    )
    outboxIds.push(outboxId)
  }

  // Single NOTIFY for the batch
  if (outboxIds.length > 0) {
    await client.query(`NOTIFY outbox_event, 'batch'`)
  }

  return outboxIds
}
