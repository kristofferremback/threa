import { Pool } from "pg"
import { withTransaction, withClient } from "../db"
import { StreamEventRepository, EventType } from "../repositories/stream-event-repository"
import { MessageRepository, Message } from "../repositories/message-repository"
import { OutboxRepository } from "../repositories/outbox-repository"
import { eventId, messageId } from "../lib/id"

// Event payloads
export interface MessageCreatedPayload {
  messageId: string
  content: string
  contentFormat: "markdown" | "plaintext"
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
  streamId: string
  authorId: string
  authorType: "user" | "persona"
  content: string
  contentFormat?: "markdown" | "plaintext"
}

export interface EditMessageParams {
  messageId: string
  streamId: string
  content: string
  actorId: string
}

export interface DeleteMessageParams {
  messageId: string
  streamId: string
  actorId: string
}

export interface AddReactionParams {
  messageId: string
  streamId: string
  emoji: string
  userId: string
}

export interface RemoveReactionParams {
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

      // 1. Append event (source of truth)
      const event = await StreamEventRepository.insert(client, {
        id: evtId,
        streamId: params.streamId,
        eventType: "message_created",
        payload: {
          messageId: msgId,
          content: params.content,
          contentFormat: params.contentFormat ?? "markdown",
        } satisfies MessageCreatedPayload,
        actorId: params.authorId,
        actorType: params.authorType,
      })

      // 2. Update projection
      const message = await MessageRepository.insert(client, {
        id: msgId,
        streamId: params.streamId,
        sequence: event.sequence,
        authorId: params.authorId,
        authorType: params.authorType,
        content: params.content,
        contentFormat: params.contentFormat,
      })

      // 3. Publish to outbox for real-time delivery
      await OutboxRepository.insert(client, "message:created", {
        streamId: params.streamId,
        message,
      })

      return message
    })
  }

  async editMessage(params: EditMessageParams): Promise<Message | null> {
    return withTransaction(this.pool, async (client) => {
      // 1. Append event
      await StreamEventRepository.insert(client, {
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
      const message = await MessageRepository.updateContent(
        client,
        params.messageId,
        params.content,
      )

      if (message) {
        // 3. Publish to outbox
        await OutboxRepository.insert(client, "message:edited", {
          streamId: params.streamId,
          message,
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
      const message = await MessageRepository.addReaction(
        client,
        params.messageId,
        params.emoji,
        params.userId,
      )

      if (message) {
        // 3. Publish to outbox
        await OutboxRepository.insert(client, "reaction:added", {
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
      const message = await MessageRepository.removeReaction(
        client,
        params.messageId,
        params.emoji,
        params.userId,
      )

      if (message) {
        // 3. Publish to outbox
        await OutboxRepository.insert(client, "reaction:removed", {
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
    options?: { limit?: number; beforeSequence?: bigint },
  ): Promise<Message[]> {
    return withClient(this.pool, (client) =>
      MessageRepository.findByStream(client, streamId, options),
    )
  }

  async getMessageById(messageId: string): Promise<Message | null> {
    return withClient(this.pool, (client) =>
      MessageRepository.findById(client, messageId),
    )
  }
}
