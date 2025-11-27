import { Pool } from "pg"
import { logger } from "../lib/logger"
import type { User } from "../lib/types"

export interface WorkOSUser {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
}

export class UserService {
  constructor(private pool: Pool) {}

  /**
   * Ensure user exists in database (upsert)
   * Syncs user data from WorkOS to our database
   */
  async ensureUser(workosUser: WorkOSUser): Promise<void> {
    try {
      const name = [workosUser.firstName, workosUser.lastName].filter(Boolean).join(" ") || workosUser.email

      await this.pool.query(
        `INSERT INTO users (id, email, name, workos_user_id, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email, name = EXCLUDED.name, workos_user_id = EXCLUDED.workos_user_id, updated_at = NOW()`,
        [workosUser.id, workosUser.email, name, workosUser.id],
      )

      logger.debug({ user_id: workosUser.id, email: workosUser.email }, "User synced to database")
    } catch (error) {
      logger.error({ err: error, user_id: workosUser.id }, "Failed to sync user")
      throw error
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<User | null> {
    try {
      const result = await this.pool.query<User>(
        `SELECT id, email, name, workos_user_id, timezone, locale, created_at, updated_at, deleted_at, archived_at
         FROM users
         WHERE id = $1 AND deleted_at IS NULL`,
        [userId],
      )

      return result.rows[0] || null
    } catch (error) {
      logger.error({ err: error, user_id: userId }, "Failed to get user by ID")
      throw error
    }
  }

  /**
   * Get user email by ID (lightweight query)
   */
  async getUserEmail(userId: string): Promise<string | null> {
    try {
      const result = await this.pool.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [userId])

      return result.rows[0]?.email || null
    } catch (error) {
      logger.error({ err: error, user_id: userId }, "Failed to get user email")
      throw error
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(userId: string, updates: { name?: string }): Promise<User | null> {
    try {
      const setClauses: string[] = ["updated_at = NOW()"]
      const values: any[] = []
      let paramIndex = 1

      if (updates.name !== undefined) {
        setClauses.push(`name = $${paramIndex}`)
        values.push(updates.name)
        paramIndex++
      }

      if (setClauses.length === 1) {
        // Only updated_at, nothing to update
        return this.getUserById(userId)
      }

      values.push(userId)

      const result = await this.pool.query<User>(
        `UPDATE users SET ${setClauses.join(", ")} WHERE id = $${paramIndex} AND deleted_at IS NULL
         RETURNING id, email, name, workos_user_id, timezone, locale, created_at, updated_at, deleted_at, archived_at`,
        values,
      )

      logger.info({ user_id: userId, updates }, "User profile updated")
      return result.rows[0] || null
    } catch (error) {
      logger.error({ err: error, user_id: userId }, "Failed to update user profile")
      throw error
    }
  }

  /**
   * Check if user needs profile setup (name is email-like)
   */
  needsProfileSetup(user: User): boolean {
    return !user.name || user.name.includes("@")
  }

  /**
   * Get or create default workspace and channel for MVP
   * Returns channel ID
   *
   * @deprecated Use WorkspaceService.getOrCreateDefaultChannel() instead
   */
  async getDefaultChannel(): Promise<string> {
    try {
      // Check if default workspace exists
      const workspaceResult = await this.pool.query("SELECT id FROM workspaces WHERE id = 'ws_default'")

      let workspaceId: string
      if (workspaceResult.rows.length === 0) {
        // Create default workspace
        await this.pool.query("INSERT INTO workspaces (id, name) VALUES ('ws_default', 'Default Workspace')")
        workspaceId = "ws_default"
        logger.info("Created default workspace")
      } else {
        workspaceId = workspaceResult.rows[0].id
      }

      // Check if default channel exists
      const channelResult = await this.pool.query(
        "SELECT id FROM channels WHERE workspace_id = $1 AND name = '#general'",
        [workspaceId],
      )

      let channelId: string
      if (channelResult.rows.length === 0) {
        // Create default channel
        const channelIdResult = await this.pool.query(
          "INSERT INTO channels (id, workspace_id, name, description) VALUES ('chan_general', $1, '#general', 'General discussion') RETURNING id",
          [workspaceId],
        )
        channelId = channelIdResult.rows[0].id
        logger.info("Created default channel")
      } else {
        channelId = channelResult.rows[0].id
      }

      return channelId
    } catch (error) {
      logger.error({ err: error }, "Failed to get default channel")
      throw error
    }
  }

  /**
   * Get workspace ID for a channel
   * Accepts either channel ID (chan_...) or channel slug (general)
   */
  async getWorkspaceIdForChannel(channelIdOrSlug: string): Promise<string | null> {
    try {
      // Try as ID first (starts with chan_)
      let result
      if (channelIdOrSlug.startsWith("chan_")) {
        result = await this.pool.query("SELECT workspace_id FROM channels WHERE id = $1", [channelIdOrSlug])
      } else {
        // Try as slug
        result = await this.pool.query("SELECT workspace_id FROM channels WHERE slug = $1", [channelIdOrSlug])
      }
      return result.rows[0]?.workspace_id || null
    } catch (error) {
      logger.error({ err: error, channel_id: channelIdOrSlug }, "Failed to get workspace ID for channel")
      return null
    }
  }
}
