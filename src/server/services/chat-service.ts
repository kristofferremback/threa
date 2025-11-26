import { Pool } from "pg"
import { sql } from "../lib/db"
import { logger } from "../lib/logger"
import { generateId } from "../lib/id"
import { createValidSlug } from "../../shared/slug"
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

export interface MessageMention {
  type: "user" | "channel" | "crosspost"
  id: string
  label: string
  slug?: string
}

export interface CreateMessageParams {
  workspaceId: string
  channelId: string
  authorId: string
  content: string
  conversationId?: string | null
  replyToMessageId?: string | null
  mentions?: MessageMention[]
}

export interface LinkedChannel {
  id: string
  slug: string
  name: string
  isPrimary: boolean
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
  isEdited?: boolean
  updatedAt?: string
  mentions?: MessageMention[]
  isCrosspost?: boolean
  originalChannelId?: string | null
  linkedChannels?: LinkedChannel[]
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

        // 2. All accessible channels: public channels + private channels user is a member of
        // Includes is_member flag and unread counts for member channels
        client.query(
          sql`SELECT
              c.id, c.name, c.slug, c.description, c.topic, c.visibility,
              CASE WHEN cm.user_id IS NOT NULL THEN true ELSE false END as is_member,
              cm.last_read_at,
              COALESCE(cm.notify_level, 'default') as notify_level,
              CASE WHEN cm.user_id IS NOT NULL THEN
                COALESCE(
                  (SELECT COUNT(*)::int FROM messages m
                   WHERE m.channel_id = c.id
                   AND m.created_at > COALESCE(cm.last_read_at, '1970-01-01'::timestamptz)
                   AND m.deleted_at IS NULL
                   AND m.reply_to_message_id IS NULL
                   AND m.author_id != ${userId}),
                  0
                )
              ELSE 0 END as unread_count
            FROM channels c
            LEFT JOIN channel_members cm ON c.id = cm.channel_id
              AND cm.user_id = ${userId}
              AND cm.removed_at IS NULL
            WHERE c.workspace_id = ${workspaceId}
              AND c.archived_at IS NULL
              AND (
                c.visibility = 'public'
                OR (c.visibility = 'private' AND cm.user_id IS NOT NULL)
              )
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
                 AND m.deleted_at IS NULL
                 AND m.author_id != ${userId}),
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
          is_member: row.is_member,
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
      const mentions = params.mentions || []
      const mentionsJson = JSON.stringify(mentions)

      const messageResult = await client.query<Message>(
        sql`INSERT INTO messages (id, workspace_id, channel_id, conversation_id, reply_to_message_id, author_id, content, mentions)
            VALUES (${messageId}, ${params.workspaceId}, ${params.channelId}, ${params.conversationId || null}, ${params.replyToMessageId || null}, ${params.authorId}, ${params.content}, ${mentionsJson}::jsonb)
            RETURNING id, workspace_id, channel_id, conversation_id, reply_to_message_id, author_id, content, created_at, updated_at, deleted_at, mentions`,
      )

      // Add primary channel to message_channels
      await client.query(
        sql`INSERT INTO message_channels (message_id, channel_id, is_primary)
            VALUES (${messageId}, ${params.channelId}, true)
            ON CONFLICT (message_id, channel_id) DO NOTHING`,
      )

      // Handle cross-posting: add message to additional channels
      const crosspostMentions = mentions.filter((m) => m.type === "crosspost")
      const crosspostChannelIds: string[] = []
      for (const crosspost of crosspostMentions) {
        // crosspost.id is the channel ID
        if (crosspost.id && crosspost.id !== params.channelId) {
          crosspostChannelIds.push(crosspost.id)
          await client.query(
            sql`INSERT INTO message_channels (message_id, channel_id, is_primary)
                VALUES (${messageId}, ${crosspost.id}, false)
                ON CONFLICT (message_id, channel_id) DO NOTHING`,
          )
        }
      }

      // Create notifications for user mentions
      const userMentions = mentions.filter((m) => m.type === "user")
      for (const mention of userMentions) {
        // Don't notify yourself
        if (mention.id === params.authorId) continue

        const notificationId = generateId("notif")
        const preview = params.content.substring(0, 100)

        await client.query(
          sql`INSERT INTO notifications (id, workspace_id, user_id, notification_type, message_id, channel_id, conversation_id, actor_id, preview)
              VALUES (${notificationId}, ${params.workspaceId}, ${mention.id}, ${"mention"}, ${messageId}, ${params.channelId}, ${params.conversationId || null}, ${params.authorId}, ${preview})
              ON CONFLICT (workspace_id, user_id, notification_type, message_id, actor_id) DO NOTHING`,
        )

        // Create outbox event to notify the mentioned user in real-time
        const mentionOutboxId = generateId("outbox")
        await client.query(
          sql`INSERT INTO outbox (id, event_type, payload)
              VALUES (${mentionOutboxId}, ${"notification.created"}, ${JSON.stringify({
                id: notificationId,
                workspace_id: params.workspaceId,
                user_id: mention.id,
                notification_type: "mention",
                message_id: messageId,
                channel_id: params.channelId,
                conversation_id: params.conversationId || null,
                actor_id: params.authorId,
                preview,
              })})`,
        )
      }

      // Create outbox event for real-time broadcast to primary channel
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
              mentions,
              crosspost_channel_ids: crosspostChannelIds,
            })})`,
      )

      // Create additional outbox events for cross-posted channels (real-time updates)
      for (const crosspostChannelId of crosspostChannelIds) {
        const crosspostOutboxId = generateId("outbox")
        await client.query(
          sql`INSERT INTO outbox (id, event_type, payload)
              VALUES (${crosspostOutboxId}, ${"message.created"}, ${JSON.stringify({
                id: messageId,
                workspace_id: params.workspaceId,
                channel_id: crosspostChannelId,
                conversation_id: params.conversationId || null,
                reply_to_message_id: params.replyToMessageId || null,
                author_id: params.authorId,
                content: params.content,
                mentions,
                is_crosspost: true,
                original_channel_id: params.channelId,
              })})`,
        )
      }

      // Auto-mark the message as read for the author (so their own messages don't appear unread)
      // Update the read cursor to this message
      if (params.conversationId) {
        // For thread replies, update conversation read cursor
        await client.query(
          sql`UPDATE conversation_members
             SET last_read_message_id = ${messageId}, last_read_at = NOW(), updated_at = NOW()
             WHERE conversation_id = ${params.conversationId} AND user_id = ${params.authorId}`,
        )
        // Emit outbox event for read cursor update
        const readCursorOutboxId = generateId("outbox")
        await client.query(
          sql`INSERT INTO outbox (id, event_type, payload)
              VALUES (${readCursorOutboxId}, ${"read_cursor.updated"}, ${JSON.stringify({
                type: "conversation",
                conversation_id: params.conversationId,
                workspace_id: params.workspaceId,
                user_id: params.authorId,
                message_id: messageId,
              })})`,
        )
      } else {
        // For channel messages, update channel read cursor
        await client.query(
          sql`UPDATE channel_members
             SET last_read_message_id = ${messageId}, last_read_at = NOW(), updated_at = NOW()
             WHERE channel_id = ${params.channelId} AND user_id = ${params.authorId}`,
        )
        // Emit outbox event for read cursor update
        const readCursorOutboxId = generateId("outbox")
        await client.query(
          sql`INSERT INTO outbox (id, event_type, payload)
              VALUES (${readCursorOutboxId}, ${"read_cursor.updated"}, ${JSON.stringify({
                type: "channel",
                channel_id: params.channelId,
                workspace_id: params.workspaceId,
                user_id: params.authorId,
                message_id: messageId,
              })})`,
        )
      }

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
          mention_count: mentions.length,
          crosspost_count: crosspostChannelIds.length,
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
    // Get messages that are either:
    // 1. Directly in this channel (m.channel_id = channelId)
    // 2. Cross-posted to this channel (via message_channels)
    const result = await this.pool.query<{
      id: string
      author_id: string
      email: string
      author_name: string
      content: string
      created_at: Date
      updated_at: Date | null
      channel_id: string
      conversation_id: string | null
      reply_to_message_id: string | null
      reply_count: string
      revision_count: string
      message_type: string
      metadata: any
      mentions: MessageMention[] | null
      is_crosspost: boolean
      original_channel_id: string | null
    }>(
      sql`WITH channel_messages AS (
            -- Direct messages in this channel
            SELECT m.id FROM messages m
            WHERE m.channel_id = ${channelId}
              AND m.deleted_at IS NULL
              AND m.reply_to_message_id IS NULL
            UNION
            -- Cross-posted messages
            SELECT mc.message_id as id FROM message_channels mc
            INNER JOIN messages m ON mc.message_id = m.id
            WHERE mc.channel_id = ${channelId}
              AND m.deleted_at IS NULL
              AND m.reply_to_message_id IS NULL
          )
          SELECT
            m.id, m.author_id, u.email, u.name as author_name, m.content, m.created_at, m.updated_at,
            m.channel_id, m.conversation_id, m.reply_to_message_id,
            COALESCE(m.message_type, 'message') as message_type,
            m.metadata,
            COALESCE(m.mentions, '[]'::jsonb) as mentions,
            (SELECT COUNT(*) FROM messages r WHERE r.reply_to_message_id = m.id AND r.deleted_at IS NULL) as reply_count,
            (SELECT COUNT(*) FROM message_revisions mr WHERE mr.message_id = m.id AND mr.deleted_at IS NULL) as revision_count,
            CASE WHEN m.channel_id != ${channelId} THEN true ELSE false END as is_crosspost,
            CASE WHEN m.channel_id != ${channelId} THEN m.channel_id ELSE NULL END as original_channel_id
          FROM messages m
          INNER JOIN users u ON m.author_id = u.id
          WHERE m.id IN (SELECT id FROM channel_messages)
          ORDER BY m.created_at DESC
          LIMIT ${limit} OFFSET ${offset}`,
    )

    // Reverse to get chronological order
    const sortedRows = result.rows.reverse()

    // For system messages, we need to fetch additional user info
    const messagesWithSystemInfo = await Promise.all(
      sortedRows.map(async (row) => {
        const base = {
          id: row.id,
          userId: row.author_id,
          email: row.email,
          message: row.content,
          timestamp: row.created_at.toISOString(),
          channelId: row.channel_id,
          conversationId: row.conversation_id,
          replyToMessageId: row.reply_to_message_id,
          replyCount: parseInt(row.reply_count, 10),
          isEdited: parseInt(row.revision_count, 10) > 0,
          updatedAt: row.updated_at?.toISOString(),
          messageType: row.message_type as "message" | "system",
          metadata: row.metadata,
          mentions: row.mentions || [],
          isCrosspost: row.is_crosspost,
          originalChannelId: row.original_channel_id,
        }

        // For system messages, enrich with user names
        if (row.message_type === "system" && row.metadata) {
          const metadata = row.metadata
          if (metadata.addedByUserId && metadata.addedByUserId !== metadata.userId) {
            const addedByUser = await this.pool.query<{ email: string; name: string }>(
              sql`SELECT email, name FROM users WHERE id = ${metadata.addedByUserId}`,
            )
            if (addedByUser.rows[0]) {
              base.metadata = {
                ...metadata,
                addedByEmail: addedByUser.rows[0].email,
                addedByName: addedByUser.rows[0].name,
                userName: row.author_name,
                userEmail: row.email,
              }
            }
          } else {
            base.metadata = {
              ...metadata,
              userName: row.author_name,
              userEmail: row.email,
            }
          }
        }

        return base
      }),
    )

    // Batch fetch linked channels from message_channels (for cross-posts)
    const messageIds = messagesWithSystemInfo.map(m => m.id)
    const messageLinkedChannelsMap: Map<string, LinkedChannel[]> = new Map()

    if (messageIds.length > 0) {
      const messageChannelsResult = await this.pool.query<{
        message_id: string
        channel_id: string
        channel_slug: string
        channel_name: string
        is_primary: boolean
      }>(
        sql`SELECT
              mc.message_id,
              c.id as channel_id,
              c.slug as channel_slug,
              c.name as channel_name,
              mc.is_primary
            FROM message_channels mc
            INNER JOIN channels c ON mc.channel_id = c.id
            WHERE mc.message_id = ANY(${messageIds})
            ORDER BY mc.is_primary DESC, c.name ASC`
      )

      for (const row of messageChannelsResult.rows) {
        const channels = messageLinkedChannelsMap.get(row.message_id) || []
        channels.push({
          id: row.channel_id,
          slug: row.channel_slug,
          name: row.channel_name,
          isPrimary: row.is_primary,
        })
        messageLinkedChannelsMap.set(row.message_id, channels)
      }
    }

    // Also fetch linked channels for conversations
    const conversationIds = [...new Set(messagesWithSystemInfo.filter(m => m.conversationId).map(m => m.conversationId!))]
    const conversationLinkedChannelsMap: Map<string, LinkedChannel[]> = new Map()

    if (conversationIds.length > 0) {
      const linkedChannelsResult = await this.pool.query<{
        conversation_id: string
        channel_id: string
        channel_slug: string
        channel_name: string
        is_primary: boolean
      }>(
        sql`SELECT
              cc.conversation_id,
              c.id as channel_id,
              c.slug as channel_slug,
              c.name as channel_name,
              cc.is_primary
            FROM conversation_channels cc
            INNER JOIN channels c ON cc.channel_id = c.id
            WHERE cc.conversation_id = ANY(${conversationIds})
            ORDER BY cc.is_primary DESC, c.name ASC`
      )

      for (const row of linkedChannelsResult.rows) {
        const channels = conversationLinkedChannelsMap.get(row.conversation_id) || []
        channels.push({
          id: row.channel_id,
          slug: row.channel_slug,
          name: row.channel_name,
          isPrimary: row.is_primary,
        })
        conversationLinkedChannelsMap.set(row.conversation_id, channels)
      }
    }

    // Attach linked channels to messages (prefer message_channels, fallback to conversation_channels)
    const messagesWithLinkedChannels = messagesWithSystemInfo.map(msg => {
      // Check message_channels first (for cross-posted messages)
      const messageChannels = messageLinkedChannelsMap.get(msg.id)
      if (messageChannels && messageChannels.length > 1) {
        return { ...msg, linkedChannels: messageChannels }
      }
      // Fall back to conversation_channels for multi-channel conversations
      if (msg.conversationId) {
        const convChannels = conversationLinkedChannelsMap.get(msg.conversationId)
        if (convChannels && convChannels.length > 1) {
          return { ...msg, linkedChannels: convChannels }
        }
      }
      return msg
    })

    return messagesWithLinkedChannels
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
    // Use addChannelMember with the user as both the member and the adder (self-join)
    await this.addChannelMember(channelId, userId, userId)
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

  async getChannelMembers(channelId: string): Promise<
    Array<{
      userId: string
      email: string
      name: string
      role: string
    }>
  > {
    const result = await this.pool.query<{
      user_id: string
      email: string
      name: string
      role: string
    }>(
      sql`SELECT cm.user_id, u.email, u.name, COALESCE(cm.role, 'member') as role
          FROM channel_members cm
          INNER JOIN users u ON cm.user_id = u.id
          WHERE cm.channel_id = ${channelId}
            AND cm.removed_at IS NULL
          ORDER BY cm.added_at ASC`,
    )

    return result.rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      name: row.name,
      role: row.role || "member",
    }))
  }

  async addChannelMember(
    channelId: string,
    userId: string,
    addedByUserId?: string,
    role: string = "member",
  ): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      // Add the member
      await client.query(
        sql`INSERT INTO channel_members (channel_id, user_id, role, added_at, updated_at, notify_level, last_read_at)
           VALUES (${channelId}, ${userId}, ${role}, NOW(), NOW(), 'default', NOW())
           ON CONFLICT (channel_id, user_id) DO UPDATE
           SET removed_at = NULL, role = ${role}, updated_at = NOW()`,
      )

      // Get channel info for the system message
      const channelResult = await client.query<{ workspace_id: string }>(
        sql`SELECT workspace_id FROM channels WHERE id = ${channelId}`,
      )
      const channel = channelResult.rows[0]

      if (channel) {
        // Create system message for the event
        const messageId = generateId("msg")
        const isJoining = !addedByUserId || addedByUserId === userId
        const eventType = isJoining ? "member_joined" : "member_added"

        const metadata = {
          event: eventType,
          userId,
          addedByUserId: addedByUserId || userId,
        }

        await client.query(
          sql`INSERT INTO messages (id, workspace_id, channel_id, author_id, content, message_type, metadata, created_at)
             VALUES (${messageId}, ${channel.workspace_id}, ${channelId}, ${userId}, '', 'system', ${JSON.stringify(metadata)}, NOW())`,
        )

        // Create outbox event for real-time
        const outboxId = generateId("outbox")
        await client.query(
          sql`INSERT INTO outbox (id, event_type, payload)
              VALUES (${outboxId}, ${"channel.member_added"}, ${JSON.stringify({
                channelId,
                workspaceId: channel.workspace_id,
                messageId,
                userId,
                addedByUserId: addedByUserId || userId,
                eventType,
              })})`,
        )
      }

      await client.query("COMMIT")
      logger.debug({ channel_id: channelId, user_id: userId, role, added_by: addedByUserId }, "Added member to channel")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async removeChannelMember(channelId: string, userId: string, removedByUserId: string): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      // Remove the member
      await client.query(
        sql`UPDATE channel_members
           SET removed_at = NOW(), updated_at = NOW()
           WHERE channel_id = ${channelId} AND user_id = ${userId}`,
      )

      // Get channel info for the outbox event
      const channelResult = await client.query<{ workspace_id: string; name: string }>(
        sql`SELECT workspace_id, name FROM channels WHERE id = ${channelId}`,
      )
      const channel = channelResult.rows[0]

      if (channel) {
        // Create outbox event for real-time notification
        const outboxId = generateId("outbox")
        await client.query(
          sql`INSERT INTO outbox (id, event_type, payload)
              VALUES (${outboxId}, ${"channel.member_removed"}, ${JSON.stringify({
                channelId,
                channelName: channel.name,
                workspaceId: channel.workspace_id,
                userId,
                removedByUserId,
              })})`,
        )
      }

      await client.query("COMMIT")
      logger.debug(
        { channel_id: channelId, user_id: userId, removed_by: removedByUserId },
        "Removed member from channel",
      )
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async findUserByEmailInWorkspace(
    workspaceId: string,
    email: string,
  ): Promise<{ id: string; email: string; name: string } | null> {
    const result = await this.pool.query<{ id: string; email: string; name: string }>(
      sql`SELECT u.id, u.email, u.name
          FROM users u
          INNER JOIN workspace_members wm ON u.id = wm.user_id
          WHERE wm.workspace_id = ${workspaceId}
            AND LOWER(u.email) = LOWER(${email})
            AND wm.status = 'active'
          LIMIT 1`,
    )

    return result.rows[0] || null
  }

  async searchWorkspaceMembers(
    workspaceId: string,
    query: string,
    excludeChannelId?: string,
  ): Promise<Array<{ id: string; email: string; name: string }>> {
    const searchPattern = `%${query.toLowerCase()}%`

    // If excludeChannelId is provided, exclude users who are already members of that channel
    if (excludeChannelId) {
      const result = await this.pool.query<{ id: string; email: string; name: string }>(
        sql`SELECT u.id, u.email, u.name
            FROM users u
            INNER JOIN workspace_members wm ON u.id = wm.user_id
            WHERE wm.workspace_id = ${workspaceId}
              AND wm.status = 'active'
              AND (LOWER(u.email) LIKE ${searchPattern} OR LOWER(u.name) LIKE ${searchPattern})
              AND u.id NOT IN (
                SELECT cm.user_id FROM channel_members cm
                WHERE cm.channel_id = ${excludeChannelId}
                  AND cm.removed_at IS NULL
              )
            ORDER BY u.name ASC, u.email ASC
            LIMIT 10`,
      )
      return result.rows
    }

    const result = await this.pool.query<{ id: string; email: string; name: string }>(
      sql`SELECT u.id, u.email, u.name
          FROM users u
          INNER JOIN workspace_members wm ON u.id = wm.user_id
          WHERE wm.workspace_id = ${workspaceId}
            AND wm.status = 'active'
            AND (LOWER(u.email) LIKE ${searchPattern} OR LOWER(u.name) LIKE ${searchPattern})
          ORDER BY u.name ASC, u.email ASC
          LIMIT 10`,
    )
    return result.rows
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

  async updateChannelReadCursor(
    channelId: string,
    userId: string,
    messageId: string,
    workspaceId?: string,
  ): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      await client.query(
        sql`UPDATE channel_members
           SET last_read_message_id = ${messageId}, last_read_at = NOW(), updated_at = NOW()
           WHERE channel_id = ${channelId} AND user_id = ${userId}`,
      )

      // Emit outbox event for real-time sync across devices
      const outboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${outboxId}, ${"read_cursor.updated"}, ${JSON.stringify({
              type: "channel",
              channel_id: channelId,
              workspace_id: workspaceId,
              user_id: userId,
              message_id: messageId,
            })})`,
      )

      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async updateConversationReadCursor(
    conversationId: string,
    userId: string,
    messageId: string,
    workspaceId?: string,
  ): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      await client.query(
        sql`UPDATE conversation_members
           SET last_read_message_id = ${messageId}, last_read_at = NOW(), updated_at = NOW()
           WHERE conversation_id = ${conversationId} AND user_id = ${userId}`,
      )

      // Emit outbox event for real-time sync across devices
      const outboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${outboxId}, ${"read_cursor.updated"}, ${JSON.stringify({
              type: "conversation",
              conversation_id: conversationId,
              workspace_id: workspaceId,
              user_id: userId,
              message_id: messageId,
            })})`,
      )

      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async getChannelReadCursor(
    channelId: string,
    userId: string,
  ): Promise<{ lastReadMessageId: string | null; lastReadAt: Date | null }> {
    const result = await this.pool.query<{ last_read_message_id: string | null; last_read_at: Date | null }>(
      sql`SELECT last_read_message_id, last_read_at
          FROM channel_members
          WHERE channel_id = ${channelId} AND user_id = ${userId}`,
    )
    const row = result.rows[0]
    return {
      lastReadMessageId: row?.last_read_message_id || null,
      lastReadAt: row?.last_read_at || null,
    }
  }

  async getConversationReadCursor(
    conversationId: string,
    userId: string,
  ): Promise<{ lastReadMessageId: string | null; lastReadAt: Date | null }> {
    const result = await this.pool.query<{ last_read_message_id: string | null; last_read_at: Date | null }>(
      sql`SELECT last_read_message_id, last_read_at
          FROM conversation_members
          WHERE conversation_id = ${conversationId} AND user_id = ${userId}`,
    )
    const row = result.rows[0]
    return {
      lastReadMessageId: row?.last_read_message_id || null,
      lastReadAt: row?.last_read_at || null,
    }
  }

  async markMessageAsUnread(
    channelId: string,
    userId: string,
    messageId: string,
    workspaceId?: string,
  ): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      // To mark as unread, we set the last_read_message_id to the message BEFORE this one
      // If no previous message, we clear the last_read_message_id
      const previousMessage = await client.query<{ id: string }>(
        sql`SELECT id FROM messages
            WHERE channel_id = ${channelId}
              AND deleted_at IS NULL
              AND created_at < (SELECT created_at FROM messages WHERE id = ${messageId})
            ORDER BY created_at DESC
            LIMIT 1`,
      )

      const previousMessageId = previousMessage.rows[0]?.id || null

      await client.query(
        sql`UPDATE channel_members
            SET last_read_message_id = ${previousMessageId},
                last_read_at = ${previousMessageId ? new Date() : null},
                updated_at = NOW()
            WHERE channel_id = ${channelId} AND user_id = ${userId}`,
      )

      // Emit outbox event for real-time sync across devices
      const outboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${outboxId}, ${"read_cursor.updated"}, ${JSON.stringify({
              type: "channel",
              channel_id: channelId,
              workspace_id: workspaceId,
              user_id: userId,
              message_id: previousMessageId, // The new read cursor position
            })})`,
      )

      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async markConversationMessageAsUnread(
    conversationId: string,
    userId: string,
    messageId: string,
    workspaceId?: string,
  ): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      const previousMessage = await client.query<{ id: string }>(
        sql`SELECT id FROM messages
            WHERE conversation_id = ${conversationId}
              AND deleted_at IS NULL
              AND created_at < (SELECT created_at FROM messages WHERE id = ${messageId})
            ORDER BY created_at DESC
            LIMIT 1`,
      )

      const previousMessageId = previousMessage.rows[0]?.id || null

      await client.query(
        sql`UPDATE conversation_members
            SET last_read_message_id = ${previousMessageId},
                last_read_at = ${previousMessageId ? new Date() : null},
                updated_at = NOW()
            WHERE conversation_id = ${conversationId} AND user_id = ${userId}`,
      )

      // Emit outbox event for real-time sync across devices
      const outboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${outboxId}, ${"read_cursor.updated"}, ${JSON.stringify({
              type: "conversation",
              conversation_id: conversationId,
              workspace_id: workspaceId,
              user_id: userId,
              message_id: previousMessageId, // The new read cursor position
            })})`,
      )

      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async editMessage(
    messageId: string,
    userId: string,
    newContent: string,
  ): Promise<{ message: Message; revisionId: string }> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      // Get the current message
      const currentMessage = await client.query<Message>(
        sql`SELECT id, workspace_id, channel_id, conversation_id, reply_to_message_id, author_id, content, created_at, updated_at, deleted_at
            FROM messages
            WHERE id = ${messageId} AND deleted_at IS NULL`,
      )

      const message = currentMessage.rows[0]
      if (!message) {
        throw new Error("Message not found")
      }

      // Check ownership
      if (message.author_id !== userId) {
        throw new Error("You can only edit your own messages")
      }

      // Create a revision with the OLD content
      const revisionId = generateId("rev")
      await client.query(
        sql`INSERT INTO message_revisions (id, message_id, content, created_at, updated_at)
            VALUES (${revisionId}, ${messageId}, ${message.content}, ${message.created_at}, NOW())`,
      )

      // Update the message with new content
      const updatedMessage = await client.query<Message>(
        sql`UPDATE messages
            SET content = ${newContent}, updated_at = NOW()
            WHERE id = ${messageId}
            RETURNING id, workspace_id, channel_id, conversation_id, reply_to_message_id, author_id, content, created_at, updated_at, deleted_at`,
      )

      const updated = updatedMessage.rows[0]
      if (!updated) {
        throw new Error("Failed to update message")
      }

      // Create outbox event for real-time broadcast
      const outboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${outboxId}, ${"message.edited"}, ${JSON.stringify({
              id: messageId,
              workspace_id: updated.workspace_id,
              channel_id: updated.channel_id,
              conversation_id: updated.conversation_id,
              author_id: updated.author_id,
              content: newContent,
              revision_id: revisionId,
              updated_at: updated.updated_at,
            })})`,
      )

      await client.query(`NOTIFY outbox_event, '${outboxId.replace(/'/g, "''")}'`)

      await client.query("COMMIT")

      logger.info({ message_id: messageId, revision_id: revisionId }, "Message edited")

      return { message: updated, revisionId }
    } catch (error) {
      await client.query("ROLLBACK")
      logger.error({ err: error }, "Failed to edit message")
      throw error
    } finally {
      client.release()
    }
  }

  async getMessageRevisions(messageId: string): Promise<Array<{ id: string; content: string; created_at: Date }>> {
    const result = await this.pool.query<{ id: string; content: string; created_at: Date }>(
      sql`SELECT id, content, created_at
          FROM message_revisions
          WHERE message_id = ${messageId} AND deleted_at IS NULL
          ORDER BY created_at DESC`,
    )
    return result.rows
  }

  async hasRevisions(messageId: string): Promise<boolean> {
    const result = await this.pool.query<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM message_revisions WHERE message_id = ${messageId} AND deleted_at IS NULL`,
    )
    return parseInt(result.rows[0]?.count || "0", 10) > 0
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

  /**
   * Check if a channel slug exists in the workspace (including archived channels).
   * Returns info about the channel for UI warnings.
   */
  async checkChannelSlugExists(
    workspaceId: string,
    slug: string,
    userId: string,
  ): Promise<{
    exists: boolean
    isArchived?: boolean
    isPrivate?: boolean
    isMember?: boolean
    channelName?: string
  }> {
    const result = await this.pool.query<{
      id: string
      name: string
      visibility: string
      archived_at: Date | null
      is_member: boolean
    }>(
      sql`SELECT
            c.id, c.name, c.visibility, c.archived_at,
            EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = ${userId} AND cm.removed_at IS NULL) as is_member
          FROM channels c
          WHERE c.workspace_id = ${workspaceId} AND c.slug = ${slug}`,
    )

    const channel = result.rows[0]
    if (!channel) {
      return { exists: false }
    }

    return {
      exists: true,
      isArchived: channel.archived_at !== null,
      isPrivate: channel.visibility === "private",
      isMember: channel.is_member,
      channelName: channel.name,
    }
  }

  async getChannelById(channelId: string): Promise<Channel | null> {
    const result = await this.pool.query<Channel>(
      sql`SELECT id, workspace_id, name, slug, description, topic, visibility, created_at, updated_at, archived_at
         FROM channels
         WHERE id = ${channelId} AND archived_at IS NULL`,
    )
    return result.rows[0] || null
  }

  // ==========================================================================
  // Channel Management
  // ==========================================================================

  async createChannel(
    workspaceId: string,
    name: string,
    creatorId: string,
    options?: {
      description?: string
      visibility?: "public" | "private"
    },
  ): Promise<Channel> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      const channelId = generateId("chan")
      const { slug, valid, error } = createValidSlug(name)
      const visibility = options?.visibility || "public"
      const description = options?.description || null

      // Validate slug
      if (!valid) {
        throw new Error(error || "Invalid channel name")
      }

      // Check if slug already exists in workspace
      const existingChannel = await client.query(
        sql`SELECT id FROM channels WHERE workspace_id = ${workspaceId} AND slug = ${slug} AND archived_at IS NULL`,
      )

      if (existingChannel.rows.length > 0) {
        throw new Error(`Channel with name "${name}" already exists`)
      }

      const channelResult = await client.query<Channel>(
        sql`INSERT INTO channels (id, workspace_id, name, slug, description, visibility)
            VALUES (${channelId}, ${workspaceId}, ${name}, ${slug}, ${description}, ${visibility})
            RETURNING id, workspace_id, name, slug, description, topic, visibility, created_at, updated_at, archived_at`,
      )

      const channel = channelResult.rows[0]
      if (!channel) {
        throw new Error("Failed to create channel")
      }

      // Add creator as admin member
      await client.query(
        sql`INSERT INTO channel_members (channel_id, user_id, role, added_at, updated_at, notify_level, last_read_at)
            VALUES (${channelId}, ${creatorId}, 'admin', NOW(), NOW(), 'all', NOW())`,
      )

      // Create outbox event
      const outboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${outboxId}, ${"channel.created"}, ${JSON.stringify({
              id: channelId,
              workspace_id: workspaceId,
              name,
              slug,
              description,
              visibility,
              creator_id: creatorId,
            })})`,
      )

      await client.query(`NOTIFY outbox_event, '${outboxId.replace(/'/g, "''")}'`)

      await client.query("COMMIT")

      logger.info({ channel_id: channelId, workspace_id: workspaceId, name }, "Channel created")

      return channel
    } catch (error) {
      await client.query("ROLLBACK")
      logger.error({ err: error }, "Failed to create channel")
      throw error
    } finally {
      client.release()
    }
  }

  async updateChannel(
    channelId: string,
    updates: {
      name?: string
      topic?: string
      description?: string
    },
  ): Promise<Channel> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      // Get current channel
      const current = await this.getChannelById(channelId)
      if (!current) {
        throw new Error("Channel not found")
      }

      // Build update fields
      const newName = updates.name?.trim() || current.name
      let newSlug = current.slug

      // Validate new slug if name is being updated
      if (updates.name) {
        const slugResult = createValidSlug(updates.name)
        if (!slugResult.valid) {
          throw new Error(slugResult.error || "Invalid channel name")
        }
        newSlug = slugResult.slug
      }

      const newTopic = updates.topic !== undefined ? updates.topic.trim() || null : current.topic
      const newDescription =
        updates.description !== undefined ? updates.description.trim() || null : current.description

      // Check for slug conflict if name changed
      if (updates.name && newSlug !== current.slug) {
        const existingChannel = await client.query(
          sql`SELECT id FROM channels WHERE workspace_id = ${current.workspace_id} AND slug = ${newSlug} AND id != ${channelId} AND archived_at IS NULL`,
        )
        if (existingChannel.rows.length > 0) {
          throw new Error(`Channel with name "${updates.name}" already exists`)
        }
      }

      const result = await client.query<Channel>(
        sql`UPDATE channels
            SET name = ${newName}, slug = ${newSlug}, topic = ${newTopic}, description = ${newDescription}, updated_at = NOW()
            WHERE id = ${channelId}
            RETURNING id, workspace_id, name, slug, description, topic, visibility, created_at, updated_at, archived_at`,
      )

      const channel = result.rows[0]
      if (!channel) {
        throw new Error("Failed to update channel")
      }

      // Create outbox event
      const outboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${outboxId}, ${"channel.updated"}, ${JSON.stringify({
              id: channelId,
              workspace_id: current.workspace_id,
              name: newName,
              slug: newSlug,
              topic: newTopic,
              description: newDescription,
            })})`,
      )

      await client.query(`NOTIFY outbox_event, '${outboxId.replace(/'/g, "''")}'`)

      await client.query("COMMIT")

      logger.info({ channel_id: channelId, updates }, "Channel updated")

      return channel
    } catch (error) {
      await client.query("ROLLBACK")
      logger.error({ err: error }, "Failed to update channel")
      throw error
    } finally {
      client.release()
    }
  }

  async archiveChannel(channelId: string): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      const current = await this.getChannelById(channelId)
      if (!current) {
        throw new Error("Channel not found")
      }

      await client.query(sql`UPDATE channels SET archived_at = NOW(), updated_at = NOW() WHERE id = ${channelId}`)

      // Create outbox event
      const outboxId = generateId("outbox")
      await client.query(
        sql`INSERT INTO outbox (id, event_type, payload)
            VALUES (${outboxId}, ${"channel.archived"}, ${JSON.stringify({
              id: channelId,
              workspace_id: current.workspace_id,
            })})`,
      )

      await client.query(`NOTIFY outbox_event, '${outboxId.replace(/'/g, "''")}'`)

      await client.query("COMMIT")

      logger.info({ channel_id: channelId }, "Channel archived")
    } catch (error) {
      await client.query("ROLLBACK")
      logger.error({ err: error }, "Failed to archive channel")
      throw error
    } finally {
      client.release()
    }
  }

  // ==========================================================================
  // Notifications / Activity Feed
  // ==========================================================================

  async getNotifications(
    workspaceId: string,
    userId: string,
    options: { limit?: number; offset?: number; unreadOnly?: boolean } = {},
  ): Promise<{
    notifications: Array<{
      id: string
      type: string
      messageId: string | null
      channelId: string | null
      channelName: string | null
      channelSlug: string | null
      conversationId: string | null
      actorId: string | null
      actorName: string | null
      actorEmail: string | null
      preview: string | null
      readAt: string | null
      createdAt: string
    }>
    unreadCount: number
  }> {
    const { limit = 50, offset = 0, unreadOnly = false } = options

    // Build the query based on unreadOnly flag
    const result = unreadOnly
      ? await this.pool.query<{
          id: string
          notification_type: string
          message_id: string | null
          channel_id: string | null
          channel_name: string | null
          channel_slug: string | null
          conversation_id: string | null
          actor_id: string | null
          actor_name: string | null
          actor_email: string | null
          preview: string | null
          read_at: Date | null
          created_at: Date
        }>(
          sql`SELECT
                n.id, n.notification_type, n.message_id, n.channel_id, n.conversation_id,
                n.actor_id, n.preview, n.read_at, n.created_at,
                c.name as channel_name, c.slug as channel_slug,
                u.name as actor_name, u.email as actor_email
              FROM notifications n
              LEFT JOIN channels c ON n.channel_id = c.id
              LEFT JOIN users u ON n.actor_id = u.id
              WHERE n.workspace_id = ${workspaceId}
                AND n.user_id = ${userId}
                AND n.read_at IS NULL
              ORDER BY n.created_at DESC
              LIMIT ${limit} OFFSET ${offset}`,
        )
      : await this.pool.query<{
          id: string
          notification_type: string
          message_id: string | null
          channel_id: string | null
          channel_name: string | null
          channel_slug: string | null
          conversation_id: string | null
          actor_id: string | null
          actor_name: string | null
          actor_email: string | null
          preview: string | null
          read_at: Date | null
          created_at: Date
        }>(
          sql`SELECT
                n.id, n.notification_type, n.message_id, n.channel_id, n.conversation_id,
                n.actor_id, n.preview, n.read_at, n.created_at,
                c.name as channel_name, c.slug as channel_slug,
                u.name as actor_name, u.email as actor_email
              FROM notifications n
              LEFT JOIN channels c ON n.channel_id = c.id
              LEFT JOIN users u ON n.actor_id = u.id
              WHERE n.workspace_id = ${workspaceId}
                AND n.user_id = ${userId}
              ORDER BY n.created_at DESC
              LIMIT ${limit} OFFSET ${offset}`,
        )

    // Get unread count
    const countResult = await this.pool.query<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM notifications
          WHERE workspace_id = ${workspaceId} AND user_id = ${userId} AND read_at IS NULL`,
    )

    return {
      notifications: result.rows.map((row) => ({
        id: row.id,
        type: row.notification_type,
        messageId: row.message_id,
        channelId: row.channel_id,
        channelName: row.channel_name,
        channelSlug: row.channel_slug,
        conversationId: row.conversation_id,
        actorId: row.actor_id,
        actorName: row.actor_name,
        actorEmail: row.actor_email,
        preview: row.preview,
        readAt: row.read_at?.toISOString() || null,
        createdAt: row.created_at.toISOString(),
      })),
      unreadCount: parseInt(countResult.rows[0]?.count || "0", 10),
    }
  }

  async getUnreadNotificationCount(workspaceId: string, userId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM notifications
          WHERE workspace_id = ${workspaceId} AND user_id = ${userId} AND read_at IS NULL`,
    )
    return parseInt(result.rows[0]?.count || "0", 10)
  }

  async markNotificationAsRead(notificationId: string, userId: string): Promise<void> {
    await this.pool.query(
      sql`UPDATE notifications SET read_at = NOW()
          WHERE id = ${notificationId} AND user_id = ${userId}`,
    )
  }

  async markAllNotificationsAsRead(workspaceId: string, userId: string): Promise<void> {
    await this.pool.query(
      sql`UPDATE notifications SET read_at = NOW()
          WHERE workspace_id = ${workspaceId} AND user_id = ${userId} AND read_at IS NULL`,
    )
  }
}
