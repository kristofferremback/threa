import { Pool } from "pg"
import { withTransaction } from "../db"
import { StreamEventRepository, StreamEvent } from "../repositories/stream-event-repository"
import type { EventType, SourceItem } from "@threa/types"
import { StreamRepository } from "../repositories/stream-repository"
import { StreamMemberRepository } from "../repositories/stream-member-repository"
import { MessageRepository, Message } from "../repositories/message-repository"
import { AttachmentRepository } from "../repositories/attachment-repository"
import { OutboxRepository } from "../repositories/outbox-repository"
import { StreamPersonaParticipantRepository } from "../repositories/stream-persona-participant-repository"
import { eventId, messageId } from "../lib/id"
import { serializeBigInt } from "../lib/serialization"
import { messagesTotal } from "../lib/metrics"
import type { JSONContent } from "@threa/types"

// Event payloads
export interface AttachmentSummary {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
}

export interface MessageCreatedPayload {
  messageId: string
  contentJson: JSONContent
  contentMarkdown: string
  attachments?: AttachmentSummary[]
  sources?: SourceItem[]
  sessionId?: string
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
  memberId: string
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
  authorType: "member" | "persona"
  contentJson: JSONContent
  contentMarkdown: string
  attachmentIds?: string[]
  sources?: SourceItem[]
  sessionId?: string
}

export interface EditMessageParams {
  workspaceId: string
  messageId: string
  streamId: string
  contentJson: JSONContent
  contentMarkdown: string
  actorId: string
}

export interface DeleteMessageParams {
  workspaceId: string
  messageId: string
  streamId: string
  actorId: string
}

export interface AddReactionParams {
  workspaceId: string
  messageId: string
  streamId: string
  emoji: string
  memberId: string
}

export interface RemoveReactionParams {
  workspaceId: string
  messageId: string
  streamId: string
  emoji: string
  memberId: string
}

export class EventService {
  constructor(private pool: Pool) {}

  async createMessage(params: CreateMessageParams): Promise<Message> {
    return withTransaction(this.pool, async (client) => {
      const msgId = messageId()
      const evtId = eventId()

      // 0. Get stream for metrics and thread handling
      const stream = await StreamRepository.findById(client, params.streamId)
      const streamType = stream?.type || "unknown"

      // Increment message counter
      messagesTotal.inc({
        workspace_id: params.workspaceId,
        stream_type: streamType,
        author_type: params.authorType,
      })

      // 1. Validate and prepare attachments FIRST (before creating event)
      let attachmentSummaries: AttachmentSummary[] | undefined
      if (params.attachmentIds && params.attachmentIds.length > 0) {
        const attachments = await AttachmentRepository.findByIds(client, params.attachmentIds)
        const allValid =
          attachments.length === params.attachmentIds.length &&
          attachments.every((a) => a.workspaceId === params.workspaceId && a.messageId === null)

        if (!allValid) {
          throw new Error("Invalid attachment IDs: must be unattached and belong to this workspace")
        }

        attachmentSummaries = attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
        }))
      }

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
      })

      // 4. Update author's read position to include their own message
      // This ensures the sender's own message is never counted as unread
      if (params.authorType === "member") {
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
      // 1. Append event
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
        actorType: "member",
      })

      // 2. Update projection
      const message = await MessageRepository.updateContent(
        client,
        params.messageId,
        params.contentJson,
        params.contentMarkdown
      )

      if (message) {
        // 3. Publish to outbox
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
      // 1. Append event
      await StreamEventRepository.insert(client, {
        id: eventId(),
        streamId: params.streamId,
        eventType: "message_deleted",
        payload: {
          messageId: params.messageId,
        } satisfies MessageDeletedPayload,
        actorId: params.actorId,
        actorType: "member",
      })

      // 2. Update projection (soft delete)
      const message = await MessageRepository.softDelete(client, params.messageId)

      if (message) {
        // 3. Publish to outbox
        await OutboxRepository.insert(client, "message:deleted", {
          workspaceId: params.workspaceId,
          streamId: params.streamId,
          messageId: params.messageId,
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
          memberId: params.memberId,
        } satisfies ReactionPayload,
        actorId: params.memberId,
        actorType: "member",
      })

      // 2. Update projection
      const message = await MessageRepository.addReaction(client, params.messageId, params.emoji, params.memberId)

      if (message) {
        // 3. Publish to outbox
        await OutboxRepository.insert(client, "reaction:added", {
          workspaceId: params.workspaceId,
          streamId: params.streamId,
          messageId: params.messageId,
          emoji: params.emoji,
          memberId: params.memberId,
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
          memberId: params.memberId,
        } satisfies ReactionPayload,
        actorId: params.memberId,
        actorType: "member",
      })

      // 2. Update projection
      const message = await MessageRepository.removeReaction(client, params.messageId, params.emoji, params.memberId)

      if (message) {
        // 3. Publish to outbox
        await OutboxRepository.insert(client, "reaction:removed", {
          workspaceId: params.workspaceId,
          streamId: params.streamId,
          messageId: params.messageId,
          emoji: params.emoji,
          memberId: params.memberId,
        })
      }

      return message
    })
  }

  async getMessages(streamId: string, options?: { limit?: number; beforeSequence?: bigint }): Promise<Message[]> {
    return MessageRepository.list(this.pool, streamId, options)
  }

  async getMessageById(messageId: string): Promise<Message | null> {
    return MessageRepository.findById(this.pool, messageId)
  }

  async listEvents(
    streamId: string,
    filters?: { types?: EventType[]; limit?: number; afterSequence?: bigint; viewerId?: string }
  ): Promise<StreamEvent[]> {
    return StreamEventRepository.list(this.pool, streamId, filters)
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
}
