import { Pool } from "pg"
import { withTransaction, withClient } from "../db"
import { StreamEventRepository, EventType, StreamEvent } from "../repositories/stream-event-repository"
import { MessageRepository, Message } from "../repositories/message-repository"
import { AttachmentRepository } from "../repositories/attachment-repository"
import { OutboxRepository } from "../repositories/outbox-repository"
import { eventId, messageId } from "../lib/id"
import { serializeBigInt } from "../lib/serialization"

// Event payloads
export interface AttachmentSummary {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
}

export interface MessageCreatedPayload {
  messageId: string
  content: string
  contentFormat: "markdown" | "plaintext"
  attachments?: AttachmentSummary[]
}

export interface MessageEditedPayload {
  messageId: string
  content: string
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
  authorType: "user" | "persona"
  content: string
  contentFormat?: "markdown" | "plaintext"
  attachmentIds?: string[]
}

export interface EditMessageParams {
  workspaceId: string
  messageId: string
  streamId: string
  content: string
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
  userId: string
}

export interface RemoveReactionParams {
  workspaceId: string
  messageId: string
  streamId: string
  emoji: string
  userId: string
}

export class EventService {
  constructor(private pool: Pool) {}

  async createMessage(params: CreateMessageParams): Promise<Message> {
    return withTransaction(this.pool, async (client) => {
      const msgId = messageId()
      const evtId = eventId()

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

      // 2. Append event (source of truth) - includes attachments in payload
      const event = await StreamEventRepository.insert(client, {
        id: evtId,
        streamId: params.streamId,
        eventType: "message_created",
        payload: {
          messageId: msgId,
          content: params.content,
          contentFormat: params.contentFormat ?? "markdown",
          ...(attachmentSummaries && { attachments: attachmentSummaries }),
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
        content: params.content,
        contentFormat: params.contentFormat,
      })

      // 4. Link attachments to message (also sets streamId)
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

      // 5. Publish to outbox for real-time delivery
      await OutboxRepository.insert(client, "message:created", {
        workspaceId: params.workspaceId,
        streamId: params.streamId,
        event: serializeBigInt(event),
      })

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
          content: params.content,
        } satisfies MessageEditedPayload,
        actorId: params.actorId,
        actorType: "user",
      })

      // 2. Update projection
      const message = await MessageRepository.updateContent(client, params.messageId, params.content)

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
        actorType: "user",
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

  async getMessages(streamId: string, options?: { limit?: number; beforeSequence?: bigint }): Promise<Message[]> {
    return withClient(this.pool, (client) => MessageRepository.list(client, streamId, options))
  }

  async getMessageById(messageId: string): Promise<Message | null> {
    return withClient(this.pool, (client) => MessageRepository.findById(client, messageId))
  }

  async listEvents(
    streamId: string,
    filters?: { types?: EventType[]; limit?: number; afterSequence?: bigint }
  ): Promise<StreamEvent[]> {
    return withClient(this.pool, (client) => StreamEventRepository.list(client, streamId, filters))
  }
}
