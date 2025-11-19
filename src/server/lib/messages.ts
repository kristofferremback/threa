import { Pool } from "pg"
import { logger } from "./logger"
import { randomUUID } from "crypto"
import { UserService } from "./user-service"

export interface Message {
  id: string
  channel_id: string
  author_id: string
  content: string
  created_at: Date
  updated_at: Date | null
  deleted_at: Date | null
}

export interface CreateMessageParams {
  channelId: string
  authorId: string
  content: string
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
      const messageId = `msg_${randomUUID().replace(/-/g, "")}`

      // Insert message
      const messageResult = await client.query<Message>(
        `INSERT INTO messages (id, channel_id, author_id, content)
         VALUES ($1, $2, $3, $4)
         RETURNING id, channel_id, author_id, content, created_at, updated_at, deleted_at`,
        [messageId, params.channelId, params.authorId, params.content],
      )

      // Insert outbox event
      const outboxId = `outbox_${randomUUID().replace(/-/g, "")}`
      await client.query(
        `INSERT INTO outbox (id, event_type, payload)
         VALUES ($1, $2, $3)`,
        [
          outboxId,
          "message.created",
          JSON.stringify({
            id: messageId,
            channel_id: params.channelId,
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

      logger.debug({ message_id: message.id, channel_id: params.channelId }, "Message created")

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
        `SELECT id, channel_id, author_id, content, created_at, updated_at, deleted_at
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

// Legacy exports for backward compatibility (will be removed)
import { pool } from "./db"
import { UserService as US } from "./user-service"

const userService = new US(pool)
const messageService = new MessageService(pool, userService)

export const createMessage = (params: CreateMessageParams) => messageService.createMessage(params)
export const getMessagesByChannel = (channelId: string, limit?: number, offset?: number) =>
  messageService.getMessagesByChannel(channelId, limit, offset)
