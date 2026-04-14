import type { Pool, PoolClient } from "pg"
import { withTransaction, withClient } from "../../db"
import { StreamEventRepository, StreamEvent } from "../streams"
import { StreamRepository } from "../streams"
import { StreamMemberRepository } from "../streams"
import { MessageRepository, Message } from "./repository"
import { AttachmentRepository, isVideoAttachment } from "../attachments"
import { OutboxRepository } from "../../lib/outbox"
import { StreamPersonaParticipantRepository } from "../agents"
import { eventId, messageId, messageVersionId } from "../../lib/id"
import { MessageVersionRepository, type MessageVersion } from "./version-repository"
import { serializeBigInt } from "@threa/backend-common"
import { messagesTotal } from "../../lib/observability"
import {
  AttachmentSafetyStatuses,
  AuthorTypes,
  type AuthorType,
  type EventType,
  type SourceItem,
  type JSONContent,
} from "@threa/types"

// Event payloads
export interface AttachmentSummary {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  processingStatus?: string
}

export interface MessageCreatedPayload {
  messageId: string
  contentJson: JSONContent
  contentMarkdown: string
  attachments?: AttachmentSummary[]
  sources?: SourceItem[]
  sessionId?: string
  /** Client-generated ID for deterministic optimistic→real event dedup on the frontend */
  clientMessageId?: string
  /** Present when message was sent via an API key on behalf of a user */
  sentVia?: string
  /** External references attached by the sender (string->string). Omitted when empty. */
  metadata?: Record<string, string>
}

export interface MessageEditedPayload {
  messageId: string
  contentJson: JSONContent
  contentMarkdown: string
}

export interface MessageDeletedPayload {
  messageId: string
}

export interface ReactionPayload {
  messageId: string
  emoji: string
  userId: string
}

export interface ThreadCreatedPayload {
  threadId: string
  parentMessageId: string
}

// Service params
export interface CreateMessageParams {
  workspaceId: string
  streamId: string
  authorId: string
  authorType: AuthorType
  contentJson: JSONContent
  contentMarkdown: string
  attachmentIds?: string[]
  sources?: SourceItem[]
  sessionId?: string
  /** Client-generated idempotency key to prevent duplicate sends on retry */
  clientMessageId?: string
  /** Indicator for messages sent via API (e.g. "api" for user-scoped keys) */
  sentVia?: string
  /** External references (string->string) attached to the message. Reserved prefix: `threa.*`. */
  metadata?: Record<string, string>
}

export interface EditMessageParams {
  workspaceId: string
  messageId: string
  streamId: string
  contentJson: JSONContent
  contentMarkdown: string
  actorId: string
  actorType?: AuthorType
}

export interface DeleteMessageParams {
  workspaceId: string
  messageId: string
  streamId: string
  actorId: string
  actorType?: AuthorType
}

export interface AddReactionParams {
  workspaceId: string
  messageId: string
  streamId: string
  emoji: string
  userId: string
}

export interface RemoveReactionParams {
  workspaceId: string
  messageId: string
  streamId: string
  emoji: string
  userId: string
}

/** Sentinel thrown when ON CONFLICT DO NOTHING suppresses a duplicate messages INSERT.
 *  Carries the existing message so the caller can return it after the txn rolls back. */
class DuplicateMessageError extends Error {
  constructor(readonly existingMessage: Message) {
    super("Duplicate clientMessageId detected via ON CONFLICT")
  }
}

export class EventService {
  constructor(private pool: Pool) {}

  private async resolveActorType(
    client: PoolClient,
    streamId: string,
    actorId: string,
    actorType?: AuthorType,
    existingMessage?: Pick<Message, "authorId" | "authorType">
  ): Promise<AuthorType> {
    if (actorType) return actorType

    if (existingMessage && existingMessage.authorId === actorId) {
      return existingMessage.authorType
    }

    const [isMember, isPersona] = await Promise.all([
      StreamMemberRepository.isMember(client, streamId, actorId),
      StreamPersonaParticipantRepository.hasParticipated(client, streamId, actorId),
    ])

    if (isMember && isPersona) {
      throw new Error(`Actor ${actorId} has ambiguous type in stream ${streamId}`)
    }
    if (isMember) return AuthorTypes.USER
    if (isPersona) return AuthorTypes.PERSONA

    throw new Error(`Actor ${actorId} has no resolved type in stream ${streamId}`)
  }

  async createMessage(params: CreateMessageParams): Promise<Message> {
    try {
      return await this._createMessageTxn(params)
    } catch (error) {
      // Concurrent duplicate: the txn rolled back (no orphaned stream_events/outbox),
      // and we return the already-committed message from the winning transaction.
      if (error instanceof DuplicateMessageError) return error.existingMessage
      throw error
    }
  }

  private async _createMessageTxn(params: CreateMessageParams): Promise<Message> {
    return withTransaction(this.pool, async (client) => {
      // Fast path: if a message with this clientMessageId already exists,
      // return it without doing any writes. Handles sequential retries.
      if (params.clientMessageId) {
        const existing = await MessageRepository.findByClientMessageId(client, params.streamId, params.clientMessageId)
        if (existing) return existing
      }
      const msgId = messageId()
      const evtId = eventId()

      // 0. Get stream for thread handling (metrics deferred until after conflict check)
      const stream = await StreamRepository.findById(client, params.streamId)

      // 1. Validate and prepare attachments FIRST (before creating event)
      let attachmentSummaries: AttachmentSummary[] | undefined
      if (params.attachmentIds && params.attachmentIds.length > 0) {
        const attachments = await AttachmentRepository.findByIds(client, params.attachmentIds)
        const allValid =
          attachments.length === params.attachmentIds.length &&
          attachments.every(
            (a) =>
              a.workspaceId === params.workspaceId &&
              a.messageId === null &&
              a.safetyStatus === AttachmentSafetyStatuses.CLEAN
          )

        if (!allValid) {
          throw new Error("Invalid attachment IDs: must be clean, unattached, and belong to this workspace")
        }

        attachmentSummaries = attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          ...(isVideoAttachment(a.mimeType, a.filename) && { processingStatus: a.processingStatus }),
        }))
      }

      // Non-empty metadata only — keep payloads and projections clean of `{}`.
      const metadata = params.metadata && Object.keys(params.metadata).length > 0 ? params.metadata : undefined

      // 2. Append event (source of truth) - includes attachments and sources in payload
      const event = await StreamEventRepository.insert(client, {
        id: evtId,
        streamId: params.streamId,
        eventType: "message_created",
        payload: {
          messageId: msgId,
          contentJson: params.contentJson,
          contentMarkdown: params.contentMarkdown,
          ...(attachmentSummaries && { attachments: attachmentSummaries }),
          ...(params.sources && params.sources.length > 0 && { sources: params.sources }),
          ...(params.sessionId && { sessionId: params.sessionId }),
          ...(params.clientMessageId && { clientMessageId: params.clientMessageId }),
          ...(params.sentVia && { sentVia: params.sentVia }),
          ...(metadata && { metadata }),
        } satisfies MessageCreatedPayload,
        actorId: params.authorId,
        actorType: params.authorType,
      })

      // 3. Update projection
      const message = await MessageRepository.insert(client, {
        id: msgId,
        streamId: params.streamId,
        sequence: event.sequence,
        authorId: params.authorId,
        authorType: params.authorType,
        contentJson: params.contentJson,
        contentMarkdown: params.contentMarkdown,
        clientMessageId: params.clientMessageId,
        sentVia: params.sentVia,
        metadata,
      })

      // Concurrent duplicate detected: ON CONFLICT DO NOTHING suppressed our INSERT,
      // so the repository returned the existing message (different ID). Throw to
      // rollback the transaction — this prevents orphaned stream_events and outbox
      // entries that would reference our never-created msgId (INV-20).
      if (message.id !== msgId) {
        throw new DuplicateMessageError(message)
      }

      // Increment only after confirming this transaction owns the new message,
      // so concurrent duplicate losers (rolled back above) never overcount.
      messagesTotal.inc({
        workspace_id: params.workspaceId,
        stream_type: stream?.type || "unknown",
        author_type: params.authorType,
      })

      // 4. Update author's read position to include their own message
      // This ensures the sender's own message is never counted as unread
      if (params.authorType === "user") {
        await StreamMemberRepository.update(client, params.streamId, params.authorId, {
          lastReadEventId: evtId,
        })
      }

      // 5. Record persona participation (idempotent)
      if (params.authorType === "persona") {
        await StreamPersonaParticipantRepository.recordParticipation(client, params.streamId, params.authorId)
      }

      // 6. Link attachments to message (also sets streamId)
      if (params.attachmentIds && params.attachmentIds.length > 0) {
        const attached = await AttachmentRepository.attachToMessage(
          client,
          params.attachmentIds,
          msgId,
          params.streamId
        )
        if (attached !== params.attachmentIds.length) {
          throw new Error("Failed to attach all files")
        }
      }

      // 7. Publish to outbox for real-time delivery
      await OutboxRepository.insert(client, "message:created", {
        workspaceId: params.workspaceId,
        streamId: params.streamId,
        event: serializeBigInt(event),
      })

      // 8. Publish unread increment for sidebar updates
      // Stream-scoped: only members of this stream receive the preview content.
      // Frontend excludes the author's own messages from unread count.
      await OutboxRepository.insert(client, "stream:activity", {
        workspaceId: params.workspaceId,
        streamId: params.streamId,
        authorId: params.authorId,
        lastMessagePreview: {
          authorId: params.authorId,
          authorType: params.authorType,
          content: params.contentMarkdown,
          createdAt: event.createdAt.toISOString(),
        },
      })

      // 9. If this is a thread, update parent message's reply count
      if (stream?.parentMessageId && stream?.parentStreamId) {
        await MessageRepository.incrementReplyCount(client, stream.parentMessageId)

        // Get updated count for the event
        const parentMessage = await MessageRepository.findById(client, stream.parentMessageId)
        if (parentMessage) {
          // Emit to PARENT stream's room (not this thread's room)
          await OutboxRepository.insert(client, "message:updated", {
            workspaceId: params.workspaceId,
            streamId: stream.parentStreamId,
            messageId: stream.parentMessageId,
            updateType: "reply_count",
            replyCount: parentMessage.replyCount,
          })
        }
      }

      return message
    })
  }

  async editMessage(params: EditMessageParams): Promise<Message | null> {
    return withTransaction(this.pool, async (client) => {
      // Returns null if the message was concurrently deleted — prevents phantom edits
      const existing = await MessageRepository.findByIdForUpdate(client, params.messageId)
      if (!existing || existing.deletedAt) return null

      // No-op: content hasn't meaningfully changed
      if (params.contentMarkdown.trim() === existing.contentMarkdown.trim()) return existing

      const actorType = await this.resolveActorType(client, params.streamId, params.actorId, params.actorType, existing)

      // 1. Snapshot pre-edit content as a version record
      await MessageVersionRepository.insert(client, {
        id: messageVersionId(),
        messageId: params.messageId,
        contentJson: existing.contentJson,
        contentMarkdown: existing.contentMarkdown,
        editedBy: params.actorId,
      })

      // 2. Append event
      const event = await StreamEventRepository.insert(client, {
        id: eventId(),
        streamId: params.streamId,
        eventType: "message_edited",
        payload: {
          messageId: params.messageId,
          contentJson: params.contentJson,
          contentMarkdown: params.contentMarkdown,
        } satisfies MessageEditedPayload,
        actorId: params.actorId,
        actorType,
      })

      // 3. Update projection
      const message = await MessageRepository.updateContent(
        client,
        params.messageId,
        params.contentJson,
        params.contentMarkdown
      )

      if (message) {
        // 4. Publish to outbox
        await OutboxRepository.insert(client, "message:edited", {
          workspaceId: params.workspaceId,
          streamId: params.streamId,
          event: serializeBigInt(event),
        })
      }

      return message
    })
  }

  async deleteMessage(params: DeleteMessageParams): Promise<Message | null> {
    return withTransaction(this.pool, async (client) => {
      const existing = await MessageRepository.findByIdForUpdate(client, params.messageId)
      if (!existing || existing.deletedAt) return null

      const actorType = await this.resolveActorType(client, params.streamId, params.actorId, params.actorType, existing)

      // 1. Append event
      await StreamEventRepository.insert(client, {
        id: eventId(),
        streamId: params.streamId,
        eventType: "message_deleted",
        payload: {
          messageId: params.messageId,
        } satisfies MessageDeletedPayload,
        actorId: params.actorId,
        actorType,
      })

      // 2. Update projection (soft delete)
      const message = await MessageRepository.softDelete(client, params.messageId)

      if (message) {
        // 3. Publish to outbox
        await OutboxRepository.insert(client, "message:deleted", {
          workspaceId: params.workspaceId,
          streamId: params.streamId,
          messageId: params.messageId,
          deletedAt: message.deletedAt!.toISOString(),
        })

        // 4. If this is a thread, update parent message's reply count
        const stream = await StreamRepository.findById(client, params.streamId)
        if (stream?.parentMessageId && stream?.parentStreamId) {
          await MessageRepository.decrementReplyCount(client, stream.parentMessageId)

          // Get updated count for the event
          const parentMessage = await MessageRepository.findById(client, stream.parentMessageId)
          if (parentMessage) {
            // Emit to PARENT stream's room (not this thread's room)
            await OutboxRepository.insert(client, "message:updated", {
              workspaceId: params.workspaceId,
              streamId: stream.parentStreamId,
              messageId: stream.parentMessageId,
              updateType: "reply_count",
              replyCount: parentMessage.replyCount,
            })
          }
        }
      }

      return message
    })
  }

  async addReaction(params: AddReactionParams): Promise<Message | null> {
    return withTransaction(this.pool, async (client) => {
      // 1. Append event
      await StreamEventRepository.insert(client, {
        id: eventId(),
        streamId: params.streamId,
        eventType: "reaction_added",
        payload: {
          messageId: params.messageId,
          emoji: params.emoji,
          userId: params.userId,
        } satisfies ReactionPayload,
        actorId: params.userId,
        actorType: "user",
      })

      // 2. Update projection
      const message = await MessageRepository.addReaction(client, params.messageId, params.emoji, params.userId)

      if (message) {
        // 3. Publish to outbox
        await OutboxRepository.insert(client, "reaction:added", {
          workspaceId: params.workspaceId,
          streamId: params.streamId,
          messageId: params.messageId,
          emoji: params.emoji,
          userId: params.userId,
        })
      }

      return message
    })
  }

  async removeReaction(params: RemoveReactionParams): Promise<Message | null> {
    return withTransaction(this.pool, async (client) => {
      // 1. Append event
      await StreamEventRepository.insert(client, {
        id: eventId(),
        streamId: params.streamId,
        eventType: "reaction_removed",
        payload: {
          messageId: params.messageId,
          emoji: params.emoji,
          userId: params.userId,
        } satisfies ReactionPayload,
        actorId: params.userId,
        actorType: "user",
      })

      // 2. Update projection
      const message = await MessageRepository.removeReaction(client, params.messageId, params.emoji, params.userId)

      if (message) {
        // 3. Publish to outbox
        await OutboxRepository.insert(client, "reaction:removed", {
          workspaceId: params.workspaceId,
          streamId: params.streamId,
          messageId: params.messageId,
          emoji: params.emoji,
          userId: params.userId,
        })
      }

      return message
    })
  }

  async getMessages(
    streamId: string,
    options?: { limit?: number; beforeSequence?: bigint; afterSequence?: bigint }
  ): Promise<Message[]> {
    return MessageRepository.list(this.pool, streamId, options)
  }

  async getMessageById(messageId: string): Promise<Message | null> {
    return MessageRepository.findById(this.pool, messageId)
  }

  async listEvents(
    streamId: string,
    filters?: {
      types?: EventType[]
      limit?: number
      afterSequence?: bigint
      beforeSequence?: bigint
      viewerId?: string
    }
  ): Promise<StreamEvent[]> {
    return StreamEventRepository.list(this.pool, streamId, filters)
  }

  /**
   * Fetch events surrounding a target. Accepts either an event ID or a message ID
   * (search results return message IDs, not event IDs).
   */
  async listEventsAround(
    streamId: string,
    targetId: string,
    options?: { idType?: "event" | "message"; limit?: number; viewerId?: string }
  ): Promise<{ events: StreamEvent[]; hasOlder: boolean; hasNewer: boolean }> {
    return withClient(this.pool, async (client) => {
      let targetEvent: StreamEvent | null = null
      if (!options?.idType || options.idType === "event") {
        targetEvent = await StreamEventRepository.findById(client, targetId)
        if (targetEvent && targetEvent.streamId !== streamId) targetEvent = null
      }
      if (!targetEvent && options?.idType !== "event") {
        targetEvent = await StreamEventRepository.findByMessageId(client, streamId, targetId)
      }
      if (!targetEvent) {
        return { events: [], hasOlder: false, hasNewer: false }
      }
      return StreamEventRepository.listAround(client, streamId, targetEvent.sequence, options)
    })
  }

  /**
   * Get reply counts for multiple messages.
   * Returns a map of messageId -> replyCount
   */
  async getReplyCountsBatch(messageIds: string[]): Promise<Map<string, number>> {
    return MessageRepository.getReplyCountsBatch(this.pool, messageIds)
  }

  /**
   * Count message_created events for multiple streams.
   * Used to compute reply counts by counting messages in thread streams.
   * Returns a map of streamId -> message count
   */
  async countMessagesByStreams(streamIds: string[]): Promise<Map<string, number>> {
    return StreamEventRepository.countMessagesByStreamBatch(this.pool, streamIds)
  }

  async getMessageVersions(messageId: string): Promise<MessageVersion[]> {
    return MessageVersionRepository.listByMessageId(this.pool, messageId)
  }

  async getMessagesByIds(messageIds: string[]): Promise<Map<string, Message>> {
    return withClient(this.pool, (client) => MessageRepository.findByIds(client, messageIds))
  }

  async getLatestSequence(streamId: string): Promise<bigint | null> {
    return StreamEventRepository.getLatestSequence(this.pool, streamId)
  }

  /**
   * Enrich bootstrap events with projection state for display.
   *
   * Filters out operational events (message_edited, message_deleted) that are
   * redundant after enrichment, then injects editedAt/deletedAt/contentJson/contentMarkdown
   * from the messages projection and threadId/replyCount from the thread data map into
   * each message_created event's payload.
   */
  async enrichBootstrapEvents(
    events: StreamEvent[],
    threadDataMap: Map<string, { threadId: string; replyCount: number }>
  ): Promise<StreamEvent[]> {
    const messageCreatedEvents = events.filter((e) => e.eventType === "message_created")
    const messageIds = messageCreatedEvents.map((e) => (e.payload as MessageCreatedPayload).messageId)

    // Reactions live on the messages projection (not in events), so we must always
    // fetch when message_created events exist. This replaces an earlier guard that
    // only fetched on edits/deletes — the extra query is the cost of real-time
    // reaction enrichment on bootstrap.
    const messagesMap = messageIds.length > 0 ? await this.getMessagesByIds(messageIds) : new Map<string, Message>()

    // Event payloads snapshot attachment processingStatus at send time. Video
    // transcoding completes asynchronously, so fresh-load bootstrap must overlay
    // current processingStatus from the attachments projection; otherwise
    // long-completed videos render as "Processing" after a page refresh.
    const attachmentIds = messageCreatedEvents.flatMap((e) =>
      ((e.payload as MessageCreatedPayload).attachments ?? [])
        .filter((a) => a.processingStatus !== undefined)
        .map((a) => a.id)
    )
    const attachmentStatusMap =
      attachmentIds.length > 0
        ? await withClient(this.pool, async (client) => {
            const rows = await AttachmentRepository.findByIds(client, attachmentIds)
            return new Map(rows.map((a) => [a.id, a.processingStatus as string]))
          })
        : new Map<string, string>()

    return events
      .filter((e) => e.eventType !== "message_edited" && e.eventType !== "message_deleted")
      .map((event) => {
        if (event.eventType !== "message_created") return event
        const payload = event.payload as MessageCreatedPayload
        const threadData = threadDataMap.get(payload.messageId)
        const message = messagesMap.get(payload.messageId)

        const enrichments: Record<string, unknown> = {}
        if (threadData) {
          enrichments.threadId = threadData.threadId
          enrichments.replyCount = threadData.replyCount
        }
        if (message?.deletedAt) {
          enrichments.deletedAt = message.deletedAt.toISOString()
        } else if (message?.editedAt) {
          enrichments.editedAt = message.editedAt.toISOString()
          enrichments.contentJson = message.contentJson
          enrichments.contentMarkdown = message.contentMarkdown
        }
        if (message?.reactions && Object.keys(message.reactions).length > 0) {
          enrichments.reactions = message.reactions
        }
        if (message?.sentVia) {
          enrichments.sentVia = message.sentVia
        }

        const refreshedAttachments = payload.attachments?.map((a) => {
          if (a.processingStatus === undefined) return a
          const current = attachmentStatusMap.get(a.id)
          return current && current !== a.processingStatus ? { ...a, processingStatus: current } : a
        })
        if (refreshedAttachments && refreshedAttachments.some((a, i) => a !== payload.attachments![i])) {
          enrichments.attachments = refreshedAttachments
        }

        if (Object.keys(enrichments).length === 0) return event
        return { ...event, payload: { ...payload, ...enrichments } }
      })
  }
}
