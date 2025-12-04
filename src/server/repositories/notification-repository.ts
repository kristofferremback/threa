import type { PoolClient } from "pg"
import { sql } from "../lib/db"

/**
 * Raw database row for notifications table.
 */
export interface NotificationRow {
  id: string
  workspace_id: string
  user_id: string
  notification_type: string
  message_id: string | null
  channel_id: string | null
  conversation_id: string | null
  actor_id: string | null
  preview: string | null
  read_at: Date | null
  created_at: Date
  stream_id: string | null
  event_id: string | null
}

/**
 * Notification with joined details from related tables.
 */
export interface NotificationWithDetailsRow extends NotificationRow {
  actor_email: string | null
  actor_name: string | null
  actor_avatar: string | null
  stream_name: string | null
  stream_slug: string | null
  stream_type: string | null
}

/**
 * Parameters for inserting a notification.
 */
export interface InsertNotificationParams {
  id: string
  workspaceId: string
  userId: string
  notificationType: string
  streamId: string | null
  eventId: string | null
  actorId: string | null
  preview: string | null
}

/**
 * Repository for notifications table operations.
 *
 * Design principles:
 * - Accepts PoolClient as first parameter (enables transaction control from service)
 * - Returns raw database rows (services handle mapping)
 * - No side effects (no outbox events, no external calls)
 * - Uses explicit field selection (no SELECT *)
 */
export const NotificationRepository = {
  /**
   * Insert a notification.
   * Uses ON CONFLICT DO NOTHING to handle duplicate notifications gracefully.
   */
  async insertNotification(client: PoolClient, params: InsertNotificationParams): Promise<void> {
    await client.query(
      sql`INSERT INTO notifications (
            id, workspace_id, user_id, notification_type,
            stream_id, event_id, actor_id, preview
          )
          VALUES (
            ${params.id}, ${params.workspaceId}, ${params.userId}, ${params.notificationType},
            ${params.streamId}, ${params.eventId}, ${params.actorId}, ${params.preview}
          )
          ON CONFLICT (workspace_id, user_id, notification_type, message_id, actor_id) DO NOTHING`,
    )
  },

  /**
   * Count unread notifications for a user in a workspace.
   */
  async countUnreadNotifications(
    client: PoolClient,
    workspaceId: string,
    userId: string,
  ): Promise<number> {
    const result = await client.query<{ count: number }>(
      sql`SELECT COUNT(*)::int as count
          FROM notifications
          WHERE workspace_id = ${workspaceId}
            AND user_id = ${userId}
            AND read_at IS NULL`,
    )
    return result.rows[0]?.count ?? 0
  },

  /**
   * Find notifications with full details for display.
   * Joins with users, workspace_profiles, and streams tables.
   */
  async findNotifications(
    client: PoolClient,
    workspaceId: string,
    userId: string,
    limit: number,
  ): Promise<NotificationWithDetailsRow[]> {
    const result = await client.query<NotificationWithDetailsRow>(
      sql`SELECT
            n.id, n.workspace_id, n.user_id, n.notification_type, n.message_id,
            n.channel_id, n.conversation_id, n.actor_id, n.preview, n.read_at,
            n.created_at, n.stream_id, n.event_id,
            u.email as actor_email,
            COALESCE(wp.display_name, u.name) as actor_name,
            wp.avatar_url as actor_avatar,
            s.name as stream_name,
            s.slug as stream_slug,
            s.stream_type
          FROM notifications n
          LEFT JOIN users u ON n.actor_id = u.id
          LEFT JOIN workspace_profiles wp ON wp.workspace_id = n.workspace_id AND wp.user_id = n.actor_id
          LEFT JOIN streams s ON n.stream_id = s.id
          WHERE n.workspace_id = ${workspaceId}
            AND n.user_id = ${userId}
          ORDER BY n.created_at DESC
          LIMIT ${limit}`,
    )
    return result.rows
  },

  /**
   * Mark a single notification as read.
   */
  async markNotificationRead(
    client: PoolClient,
    notificationId: string,
    userId: string,
  ): Promise<void> {
    await client.query(
      sql`UPDATE notifications
          SET read_at = NOW()
          WHERE id = ${notificationId}
            AND user_id = ${userId}`,
    )
  },

  /**
   * Mark all notifications as read for a user in a workspace.
   */
  async markAllNotificationsRead(
    client: PoolClient,
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    await client.query(
      sql`UPDATE notifications
          SET read_at = NOW()
          WHERE workspace_id = ${workspaceId}
            AND user_id = ${userId}
            AND read_at IS NULL`,
    )
  },
}
