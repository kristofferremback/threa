import { Pool } from "pg"
import { logger } from "../lib/logger"
import { randomUUID } from "crypto"
import { generateId } from "../lib/id"

export interface Conversation {
  id: string
  workspace_id: string
  root_message_id: string
  created_at: Date
}

export interface ConversationChannel {
  conversation_id: string
  channel_id: string
  is_primary: boolean
  added_at: Date
}

export class ConversationService {
  constructor(private pool: Pool) {}

  /**
   * Create a conversation from a root message
   * The root message becomes the first message in the conversation
   */
  async createConversation(
    workspaceId: string,
    rootMessageId: string,
    primaryChannelId: string,
    additionalChannelIds?: string[],
  ): Promise<Conversation> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      const conversationId = generateId("conv")

      // Create conversation
      const conversationResult = await client.query<Conversation>(
        `INSERT INTO conversations (id, workspace_id, root_message_id)
         VALUES ($1, $2, $3)
         RETURNING id, workspace_id, root_message_id, created_at`,
        [conversationId, workspaceId, rootMessageId],
      )

      const conversation = conversationResult.rows[0]
      if (!conversation) {
        throw new Error("Failed to create conversation")
      }

      // Link conversation to primary channel
      await client.query(
        `INSERT INTO conversation_channels (conversation_id, channel_id, is_primary)
         VALUES ($1, $2, true)`,
        [conversationId, primaryChannelId],
      )

      // Link conversation to additional channels
      if (additionalChannelIds && additionalChannelIds.length > 0) {
        for (const channelId of additionalChannelIds) {
          await client.query(
            `INSERT INTO conversation_channels (conversation_id, channel_id, is_primary)
             VALUES ($1, $2, false)`,
            [conversationId, channelId],
          )
        }
      }

      // Update root message to be part of conversation
      await client.query(`UPDATE messages SET conversation_id = $1 WHERE id = $2`, [conversationId, rootMessageId])

      await client.query("COMMIT")

      logger.info(
        {
          conversation_id: conversationId,
          root_message_id: rootMessageId,
          channels: [primaryChannelId, ...(additionalChannelIds || [])],
        },
        "Conversation created",
      )

      return conversation
    } catch (error) {
      await client.query("ROLLBACK")
      logger.error({ err: error }, "Failed to create conversation")
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Add a channel to an existing conversation (multi-channel support)
   */
  async addChannelToConversation(conversationId: string, channelId: string): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO conversation_channels (conversation_id, channel_id, is_primary)
         VALUES ($1, $2, false)
         ON CONFLICT (conversation_id, channel_id) DO NOTHING`,
        [conversationId, channelId],
      )

      logger.debug({ conversation_id: conversationId, channel_id: channelId }, "Channel added to conversation")
    } catch (error) {
      logger.error(
        { err: error, conversation_id: conversationId, channel_id: channelId },
        "Failed to add channel to conversation",
      )
      throw error
    }
  }

  /**
   * Get conversation by ID
   */
  async getConversation(conversationId: string): Promise<Conversation | null> {
    try {
      const result = await this.pool.query<Conversation>(
        `SELECT id, workspace_id, root_message_id, created_at
         FROM conversations
         WHERE id = $1`,
        [conversationId],
      )

      return result.rows[0] || null
    } catch (error) {
      logger.error({ err: error, conversation_id: conversationId }, "Failed to get conversation")
      throw error
    }
  }

  /**
   * Get all channels a conversation appears in
   */
  async getConversationChannels(conversationId: string): Promise<ConversationChannel[]> {
    try {
      const result = await this.pool.query<ConversationChannel>(
        `SELECT conversation_id, channel_id, is_primary, added_at
         FROM conversation_channels
         WHERE conversation_id = $1
         ORDER BY is_primary DESC, added_at ASC`,
        [conversationId],
      )

      return result.rows
    } catch (error) {
      logger.error({ err: error, conversation_id: conversationId }, "Failed to get conversation channels")
      throw error
    }
  }

  /**
   * Get all conversations in a channel
   */
  async getConversationsByChannel(channelId: string, limit: number = 50, offset: number = 0): Promise<Conversation[]> {
    try {
      const result = await this.pool.query<Conversation>(
        `SELECT c.id, c.workspace_id, c.root_message_id, c.created_at
         FROM conversations c
         INNER JOIN conversation_channels cc ON c.id = cc.conversation_id
         WHERE cc.channel_id = $1
         ORDER BY c.created_at DESC
         LIMIT $2 OFFSET $3`,
        [channelId, limit, offset],
      )

      return result.rows
    } catch (error) {
      logger.error({ err: error, channel_id: channelId }, "Failed to get conversations by channel")
      throw error
    }
  }
}
