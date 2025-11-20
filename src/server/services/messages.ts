import { Pool } from "pg"
import { logger } from "../lib/logger"
import { randomUUID } from "crypto"
import { UserService } from "../services/user-service"
import { generateId } from "../lib/id"

export interface Message {
  id: string
  workspace_id: string
  channel_id: string
  conversation_id: string | null
  reply_to_message_id: string | null
  author_id: string
  content: string
  created_at: Date
  updated_at: Date | null
  deleted_at: Date | null
}

export interface CreateMessageParams {
  workspaceId: string
  channelId: string
  authorId: string
  content: string
  conversationId?: string | null // If provided, message is part of conversation
  replyToMessageId?: string | null // If provided, message is a reply to another message
}

export interface MessageWithAuthor {
  id: string
  userId: string
  email: string
  message: string
  timestamp: string
}

export class MessageService {
  constructor(
    private pool: Pool,
    private userService: UserService,
  ) {}

  async createMessage(params: CreateMessageParams): Promise<Message> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      // Generate message ID (using ULID format prefix as per spec)
      const messageId = generateId("msg")

      // Insert message with threading support
      const messageResult = await client.query<Message>(
        `INSERT INTO messages (id, workspace_id, channel_id, conversation_id, reply_to_message_id, author_id, content)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, workspace_id, channel_id, conversation_id, reply_to_message_id, author_id, content, created_at, updated_at, deleted_at`,
        [
          messageId,
          params.workspaceId,
          params.channelId,
          params.conversationId || null,
          params.replyToMessageId || null,
          params.authorId,
          params.content,
        ],
      )

      // Insert outbox event
      const outboxId = generateId("outbox")
      await client.query(
        `INSERT INTO outbox (id, event_type, payload)
         VALUES ($1, $2, $3)`,
        [
          outboxId,
          "message.created",
          JSON.stringify({
            id: messageId,
            workspace_id: params.workspaceId,
            channel_id: params.channelId,
            conversation_id: params.conversationId || null,
            reply_to_message_id: params.replyToMessageId || null,
            author_id: params.authorId,
            content: params.content,
          }),
        ],
      )

      await client.query("COMMIT")

      const message = messageResult.rows[0]
      if (!message) {
        throw new Error("Failed to create message - no result returned")
      }

      logger.debug(
        {
          message_id: message.id,
          channel_id: params.channelId,
          conversation_id: params.conversationId,
          reply_to_message_id: params.replyToMessageId,
        },
        "Message created",
      )

      return message
    } catch (error) {
      await client.query("ROLLBACK")
      logger.error({ err: error }, "Failed to create message")
      throw error
    } finally {
      client.release()
    }
  }

  async getMessagesByChannel(channelId: string, limit: number = 50, offset: number = 0): Promise<Message[]> {
    try {
      const result = await this.pool.query<Message>(
        `SELECT id, workspace_id, channel_id, conversation_id, reply_to_message_id, author_id, content, created_at, updated_at, deleted_at
         FROM messages
         WHERE channel_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [channelId, limit, offset],
      )

      return result.rows.reverse() // Reverse to get chronological order
    } catch (error) {
      logger.error({ err: error, channel_id: channelId }, "Failed to get messages")
      throw error
    }
  }

  async getMessageById(messageId: string): Promise<Message | null> {
    try {
      const result = await this.pool.query<Message>(
        `SELECT id, workspace_id, channel_id, conversation_id, reply_to_message_id, author_id, content, created_at, updated_at, deleted_at
         FROM messages
         WHERE id = $1 AND deleted_at IS NULL`,
        [messageId],
      )

      return result.rows[0] || null
    } catch (error) {
      logger.error({ err: error, message_id: messageId }, "Failed to get message")
      throw error
    }
  }

  /**
   * Get messages in a conversation (threaded messages)
   */
  async getMessagesByConversation(conversationId: string): Promise<Message[]> {
    try {
      const result = await this.pool.query<Message>(
        `SELECT id, workspace_id, channel_id, conversation_id, reply_to_message_id, author_id, content, created_at, updated_at, deleted_at
         FROM messages
         WHERE conversation_id = $1 AND deleted_at IS NULL
         ORDER BY created_at ASC`,
        [conversationId],
      )

      return result.rows
    } catch (error) {
      logger.error({ err: error, conversation_id: conversationId }, "Failed to get conversation messages")
      throw error
    }
  }

  async getMessageAncestors(messageId: string): Promise<Message[]> {
    try {
      const result = await this.pool.query<Message>(
        `WITH RECURSIVE ancestors AS (
           SELECT m.*
           FROM messages m
           JOIN messages target ON m.id = target.reply_to_message_id
           WHERE target.id = $1
           
           UNION ALL
           
           SELECT m.*
           FROM messages m
           INNER JOIN ancestors a ON m.id = a.reply_to_message_id
         )
         SELECT id, workspace_id, channel_id, conversation_id, reply_to_message_id, author_id, content, created_at, updated_at, deleted_at
         FROM ancestors
         ORDER BY created_at ASC`,
        [messageId],
      )

      return result.rows
    } catch (error) {
      logger.error({ err: error, message_id: messageId }, "Failed to get message ancestors")
      throw error
    }
  }

  /**
   * Get messages with author information
   */
  async getMessagesWithAuthors(
    channelId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<MessageWithAuthor[]> {
    const messages = await this.getMessagesByChannel(channelId, limit, offset)

    const messagesWithAuthors = await Promise.all(
      messages.map(async (msg) => {
        const email = await this.userService.getUserEmail(msg.author_id)
        return {
          id: msg.id,
          userId: msg.author_id,
          email: email || "unknown",
          message: msg.content,
          timestamp: msg.created_at.toISOString(),
        }
      }),
    )

    return messagesWithAuthors
  }
}
