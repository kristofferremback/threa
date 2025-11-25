import { Pool } from "pg"
import { sql } from "../lib/db"
import { logger } from "../lib/logger"
import { generateId } from "../lib/id"
import type { Message, Channel, Conversation, User, Workspace, NotificationLevel } from "../lib/types"

// ============================================================================
// Types
// ============================================================================

export interface BootstrapChannel {
  id: string
  name: string
  slug: string
  description: string | null
  topic: string | null
  visibility: "public" | "private" | "direct"
  unread_count: number
  last_read_at: Date | null
  notify_level: NotificationLevel
}

export interface BootstrapConversation {
  id: string
  root_message_id: string
  unread_count: number
  last_read_at: Date | null
  // Preview of root message
  root_message_preview: string | null
  root_message_author_id: string | null
}

export interface BootstrapUser {
  id: string
  name: string
  email: string
  role: "admin" | "member" | "guest"
}

export interface BootstrapResult {
  workspace: {
    id: string
    name: string
    slug: string
    plan_tier: string
  }
  user_role: "admin" | "member" | "guest"
  channels: BootstrapChannel[]
  conversations: BootstrapConversation[]
  users: BootstrapUser[]
}

export interface CreateMessageParams {
  workspaceId: string
  channelId: string
  authorId: string
  content: string
  conversationId?: string | null
  replyToMessageId?: string | null
}

export interface MessageWithAuthor {
  id: string
  userId: string
  email: string
  message: string
  timestamp: string
  channelId: string
  conversationId?: string | null
  replyToMessageId?: string | null
  replyCount?: number
}

// ============================================================================
// ChatService
// ============================================================================

export class ChatService {
  constructor(private pool: Pool) {}

  // ==========================================================================
  // Bootstrap
  // ==========================================================================

  async bootstrap(workspaceId: string, userId: string): Promise<BootstrapResult> {
    const client = await this.pool.connect()
    try {
      // Run queries in parallel for speed
      const [workspaceRes, channelsRes, conversationsRes, usersRes] = await Promise.all([
        // 1. Workspace info + user's role
        client.query(
          sql`SELECT
              w.id, w.name, w.slug, w.plan_tier,
              wm.role
            FROM workspaces w
            INNER JOIN workspace_members wm ON w.id = wm.workspace_id
            WHERE w.id = ${workspaceId} AND wm.user_id = ${userId}`,
        ),

        // 2. Channels the user is a member of + unread counts
        client.query(
          sql`SELECT
              c.id, c.name, c.slug, c.description, c.topic, c.visibility,
              cm.last_read_at,
              cm.notify_level,
              COALESCE(
                (SELECT COUNT(*)::int FROM messages m
                 WHERE m.channel_id = c.id
                 AND m.created_at > COALESCE(cm.last_read_at, '1970-01-01'::timestamptz)
                 AND m.deleted_at IS NULL
                 AND m.reply_to_message_id IS NULL),
                0
              ) as unread_count
            FROM channels c
            INNER JOIN channel_members cm ON c.id = cm.channel_id
            WHERE c.workspace_id = ${workspaceId}
              AND cm.user_id = ${userId}
              AND cm.removed_at IS NULL
              AND c.archived_at IS NULL
            ORDER BY c.name ASC`,
        ),

        // 3. Conversations (threads) the user is following + unread counts
        client.query(
          sql`SELECT
              c.id, c.root_message_id,
              cm.last_read_at,
              COALESCE(
                (SELECT COUNT(*)::int FROM messages m
                 WHERE m.conversation_id = c.id
                 AND m.created_at > COALESCE(cm.last_read_at, '1970-01-01'::timestamptz)
                 AND m.deleted_at IS NULL),
                0
              ) as unread_count,
              rm.content as root_message_preview,
              rm.author_id as root_message_author_id
            FROM conversations c
            INNER JOIN conversation_members cm ON c.id = cm.conversation_id
            LEFT JOIN messages rm ON c.root_message_id = rm.id
            WHERE c.workspace_id = ${workspaceId}
              AND cm.user_id = ${userId}
              AND cm.removed_at IS NULL
              AND c.deleted_at IS NULL
            ORDER BY c.updated_at DESC
            LIMIT 50`,
        ),

        // 4. Workspace members (for @mention autocomplete)
        client.query(
          sql`SELECT
              u.id, u.name, u.email,
              wm.role
            FROM users u
            INNER JOIN workspace_members wm ON u.id = wm.user_id
            WHERE wm.workspace_id = ${workspaceId}
              AND wm.status = 'active'
              AND u.deleted_at IS NULL
            ORDER BY u.name ASC`,
        ),
      ])

      const workspace = workspaceRes.rows[0]
      if (!workspace) {
        throw new Error("Workspace not found or user is not a member")
      }

      return {
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          plan_tier: workspace.plan_tier,
        },
        user_role: workspace.role,
        channels: channelsRes.rows.map((row) => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          description: row.description,
          topic: row.topic,
          visibility: row.visibility,
          unread_count: row.unread_count,
          last_read_at: row.last_read_at,
          notify_level: row.notify_level,
        })),
        conversations: conversationsRes.rows.map((row) => ({
          id: row.id,
          root_message_id: row.root_message_id,
          unread_count: row.unread_count,
          last_read_at: row.last_read_at,
          root_message_preview: row.root_message_preview ? row.root_message_preview.substring(0, 100) : null,
          root_message_author_id: row.root_message_author_id,
        })),
        users: usersRes.rows,
      }
    } finally {
      client.release()
    }
  }

  // ==========================================================================
  // Messages
  // ==========================================================================

  async createMessage(params: CreateMessageParams): Promise<Message> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      const messageId = generateId("msg")

      const messageResult = await client.query<Message>(
        sql`INSERT INTO messages (id, workspace_id, channel_id, conversation_id, reply_to_message_id, author_id, content)
            VALUES (${messageId}, ${params.workspaceId}, ${params.channelId}, ${params.conversationId || null}, ${params.replyToMessageId || null}, ${params.authorId}, ${params.content})
            RETURNING id, workspace_id, channel_id, conversation_id, reply_to_message_id, author_id, content, created_at, updated_at, deleted_at`,
      )

      // Create outbox event for real-time broadcast
      const outboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${outboxId}, ${"message.created"}, ${JSON.stringify({
              id: messageId,
              workspace_id: params.workspaceId,
              channel_id: params.channelId,
              conversation_id: params.conversationId || null,
              reply_to_message_id: params.replyToMessageId || null,
              author_id: params.authorId,
              content: params.content,
            })})`,
      )

      // NOTIFY to wake up outbox listener
      await client.query(`NOTIFY outbox_event, '${outboxId.replace(/'/g, "''")}'`)

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
    // Show messages that are NOT replies to other messages.
    // This includes:
    // - Regular channel messages (conversation_id IS NULL, reply_to_message_id IS NULL)
    // - Root messages of conversations (conversation_id IS NOT NULL, reply_to_message_id IS NULL)
    // This excludes:
    // - Reply messages in threads (reply_to_message_id IS NOT NULL)
    const result = await this.pool.query<Message>(
      sql`SELECT id, workspace_id, channel_id, conversation_id, reply_to_message_id, author_id, content, created_at, updated_at, deleted_at
          FROM messages
          WHERE channel_id = ${channelId}
            AND deleted_at IS NULL
            AND reply_to_message_id IS NULL
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}`,
    )

    return result.rows.reverse() // Reverse to get chronological order
  }

  async getMessageById(messageId: string): Promise<Message | null> {
    const result = await this.pool.query<Message>(
      sql`SELECT id, workspace_id, channel_id, conversation_id, reply_to_message_id, author_id, content, created_at, updated_at, deleted_at
          FROM messages
          WHERE id = ${messageId} AND deleted_at IS NULL`,
    )

    return result.rows[0] || null
  }

  async getMessagesByConversation(conversationId: string): Promise<Message[]> {
    // Get the conversation to find the root message
    const conversation = await this.getConversation(conversationId)
    if (!conversation) {
      return []
    }

    // Get the root message + all messages that belong to this conversation
    const result = await this.pool.query<Message>(
      sql`SELECT id, workspace_id, channel_id, conversation_id, reply_to_message_id, author_id, content, created_at, updated_at, deleted_at
          FROM messages
          WHERE (id = ${conversation.root_message_id} OR conversation_id = ${conversationId})
            AND deleted_at IS NULL
          ORDER BY created_at ASC`,
    )

    return result.rows
  }

  async getMessageAncestors(messageId: string): Promise<Message[]> {
    const result = await this.pool.query<Message>(
      sql`WITH RECURSIVE ancestors AS (
           SELECT m.*
           FROM messages m
           JOIN messages target ON m.id = target.reply_to_message_id
           WHERE target.id = ${messageId}

           UNION ALL

           SELECT m.*
           FROM messages m
           INNER JOIN ancestors a ON m.id = a.reply_to_message_id
         )
         SELECT id, workspace_id, channel_id, conversation_id, reply_to_message_id, author_id, content, created_at, updated_at, deleted_at
         FROM ancestors
         ORDER BY created_at ASC`,
    )

    return result.rows
  }

  async getReplyCount(messageId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM messages WHERE reply_to_message_id = ${messageId} AND deleted_at IS NULL`,
    )
    return parseInt(result.rows[0]?.count || "0", 10)
  }

  async getMessagesWithAuthors(
    channelId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<MessageWithAuthor[]> {
    // Join messages with users to get author info in one query
    // Show messages that are NOT replies (same logic as getMessagesByChannel)
    // Include reply count: number of messages that directly reply to this message
    const result = await this.pool.query<{
      id: string
      author_id: string
      email: string
      content: string
      created_at: Date
      channel_id: string
      conversation_id: string | null
      reply_to_message_id: string | null
      reply_count: string // PostgreSQL returns COUNT as string
    }>(
      sql`SELECT
            m.id, m.author_id, u.email, m.content, m.created_at,
            m.channel_id, m.conversation_id, m.reply_to_message_id,
            (SELECT COUNT(*) FROM messages r WHERE r.reply_to_message_id = m.id AND r.deleted_at IS NULL) as reply_count
          FROM messages m
          INNER JOIN users u ON m.author_id = u.id
          WHERE m.channel_id = ${channelId}
            AND m.deleted_at IS NULL
            AND m.reply_to_message_id IS NULL
          ORDER BY m.created_at DESC
          LIMIT ${limit} OFFSET ${offset}`,
    )

    return result.rows.reverse().map((row) => ({
      id: row.id,
      userId: row.author_id,
      email: row.email,
      message: row.content,
      timestamp: row.created_at.toISOString(),
      channelId: row.channel_id,
      conversationId: row.conversation_id,
      replyToMessageId: row.reply_to_message_id,
      replyCount: parseInt(row.reply_count, 10),
    }))
  }

  // ==========================================================================
  // Conversations
  // ==========================================================================

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
        sql`INSERT INTO conversations (id, workspace_id, root_message_id, updated_at)
           VALUES (${conversationId}, ${workspaceId}, ${rootMessageId}, NOW())
           RETURNING id, workspace_id, root_message_id, created_at, updated_at, deleted_at`,
      )

      const conversation = conversationResult.rows[0]
      if (!conversation) {
        throw new Error("Failed to create conversation")
      }

      // Link conversation to primary channel
      await client.query(
        sql`INSERT INTO conversation_channels (conversation_id, channel_id, is_primary)
           VALUES (${conversationId}, ${primaryChannelId}, true)`,
      )

      // Link conversation to additional channels
      if (additionalChannelIds && additionalChannelIds.length > 0) {
        for (const channelId of additionalChannelIds) {
          await client.query(
            sql`INSERT INTO conversation_channels (conversation_id, channel_id, is_primary)
               VALUES (${conversationId}, ${channelId}, false)`,
          )
        }
      }

      // NOTE: We do NOT set conversation_id on the root message.
      // The root message stays in its original context (channel or parent conversation).
      // The conversation's root_message_id points to it, and replies have conversation_id set.

      // Insert outbox event for conversation creation
      const outboxId = generateId("outbox")
      const allChannelIds = [primaryChannelId, ...(additionalChannelIds || [])]
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
           VALUES (${outboxId}, ${"conversation.created"}, ${JSON.stringify({
             id: conversationId,
             workspace_id: workspaceId,
             root_message_id: rootMessageId,
             channel_ids: allChannelIds,
             created_at: new Date().toISOString(),
           })})`,
      )

      // NOTIFY to wake up outbox listener
      await client.query(`NOTIFY outbox_event, '${outboxId.replace(/'/g, "''")}'`)

      await client.query("COMMIT")

      logger.info(
        {
          conversation_id: conversationId,
          root_message_id: rootMessageId,
          channels: allChannelIds,
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

  async getConversation(conversationId: string): Promise<Conversation | null> {
    const result = await this.pool.query<Conversation>(
      sql`SELECT id, workspace_id, root_message_id, created_at, updated_at, deleted_at
         FROM conversations
         WHERE id = ${conversationId} AND deleted_at IS NULL`,
    )

    return result.rows[0] || null
  }

  async getConversationByRootMessage(rootMessageId: string): Promise<Conversation | null> {
    const result = await this.pool.query<Conversation>(
      sql`SELECT id, workspace_id, root_message_id, created_at, updated_at, deleted_at
         FROM conversations
         WHERE root_message_id = ${rootMessageId} AND deleted_at IS NULL`,
    )

    return result.rows[0] || null
  }

  async addChannelToConversation(conversationId: string, channelId: string): Promise<void> {
    await this.pool.query(
      sql`INSERT INTO conversation_channels (conversation_id, channel_id, is_primary)
         VALUES (${conversationId}, ${channelId}, false)
         ON CONFLICT (conversation_id, channel_id) DO NOTHING`,
    )

    logger.debug({ conversation_id: conversationId, channel_id: channelId }, "Channel added to conversation")
  }

  // ==========================================================================
  // Channel Membership
  // ==========================================================================

  async joinChannel(channelId: string, userId: string): Promise<void> {
    await this.pool.query(
      sql`INSERT INTO channel_members (channel_id, user_id, added_at, updated_at, notify_level, last_read_at)
         VALUES (${channelId}, ${userId}, NOW(), NOW(), 'default', NOW())
         ON CONFLICT (channel_id, user_id) DO UPDATE
         SET removed_at = NULL, updated_at = NOW()`,
    )

    logger.debug({ channel_id: channelId, user_id: userId }, "User joined channel")
  }

  async leaveChannel(channelId: string, userId: string): Promise<void> {
    await this.pool.query(
      sql`UPDATE channel_members
         SET removed_at = NOW(), updated_at = NOW()
         WHERE channel_id = ${channelId} AND user_id = ${userId}`,
    )

    logger.debug({ channel_id: channelId, user_id: userId }, "User left channel")
  }

  // ==========================================================================
  // Conversation Membership
  // ==========================================================================

  async followConversation(conversationId: string, userId: string): Promise<void> {
    await this.pool.query(
      sql`INSERT INTO conversation_members (conversation_id, user_id, added_at, updated_at, notify_level, last_read_at)
         VALUES (${conversationId}, ${userId}, NOW(), NOW(), 'default', NOW())
         ON CONFLICT (conversation_id, user_id) DO UPDATE
         SET removed_at = NULL, updated_at = NOW()`,
    )

    logger.debug({ conversation_id: conversationId, user_id: userId }, "User followed conversation")
  }

  async unfollowConversation(conversationId: string, userId: string): Promise<void> {
    await this.pool.query(
      sql`UPDATE conversation_members
         SET removed_at = NOW(), updated_at = NOW()
         WHERE conversation_id = ${conversationId} AND user_id = ${userId}`,
    )

    logger.debug({ conversation_id: conversationId, user_id: userId }, "User unfollowed conversation")
  }

  // ==========================================================================
  // Read Receipts
  // ==========================================================================

  async updateChannelReadCursor(channelId: string, userId: string, messageId: string): Promise<void> {
    await this.pool.query(
      sql`UPDATE channel_members
         SET last_read_message_id = ${messageId}, last_read_at = NOW(), updated_at = NOW()
         WHERE channel_id = ${channelId} AND user_id = ${userId}`,
    )
  }

  async updateConversationReadCursor(conversationId: string, userId: string, messageId: string): Promise<void> {
    await this.pool.query(
      sql`UPDATE conversation_members
         SET last_read_message_id = ${messageId}, last_read_at = NOW(), updated_at = NOW()
         WHERE conversation_id = ${conversationId} AND user_id = ${userId}`,
    )
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  async getUserEmail(userId: string): Promise<string | null> {
    const result = await this.pool.query<{ email: string }>(sql`SELECT email FROM users WHERE id = ${userId}`)
    return result.rows[0]?.email || null
  }

  async getChannelBySlug(workspaceId: string, slug: string): Promise<Channel | null> {
    const result = await this.pool.query<Channel>(
      sql`SELECT id, workspace_id, name, slug, description, topic, visibility, created_at, updated_at, archived_at
         FROM channels
         WHERE workspace_id = ${workspaceId} AND slug = ${slug} AND archived_at IS NULL`,
    )
    return result.rows[0] || null
  }

  async getChannelById(channelId: string): Promise<Channel | null> {
    const result = await this.pool.query<Channel>(
      sql`SELECT id, workspace_id, name, slug, description, topic, visibility, created_at, updated_at, archived_at
         FROM channels
         WHERE id = ${channelId} AND archived_at IS NULL`,
    )
    return result.rows[0] || null
  }
}
