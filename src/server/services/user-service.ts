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
    const name = [workosUser.firstName, workosUser.lastName].filter(Boolean).join(" ") || workosUser.email

    await this.pool.query(
      `INSERT INTO users (id, email, name, workos_user_id, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO UPDATE
       SET email = EXCLUDED.email, name = EXCLUDED.name, workos_user_id = EXCLUDED.workos_user_id, updated_at = NOW()`,
      [workosUser.id, workosUser.email, name, workosUser.id],
    )

    logger.debug({ user_id: workosUser.id, email: workosUser.email }, "User synced to database")
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<User | null> {
    const result = await this.pool.query<User>(
      `SELECT id, email, name, workos_user_id, timezone, locale, created_at, updated_at, deleted_at, archived_at
       FROM users
       WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    )

    return result.rows[0] || null
  }

  /**
   * Get user email by ID (lightweight query)
   */
  async getUserEmail(userId: string): Promise<string | null> {
    const result = await this.pool.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [userId])

    return result.rows[0]?.email || null
  }

  /**
   * Update user profile
   */
  async updateProfile(userId: string, updates: { name?: string }): Promise<User | null> {
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
  }

  /**
   * Check if user needs profile setup (name is email-like)
   */
  needsProfileSetup(user: User): boolean {
    return !user.name || user.name.includes("@")
  }

  /**
   * Get or create default workspace and channel for MVP
   * Returns stream ID
   *
   * @deprecated Use WorkspaceService.getOrCreateDefaultChannel() instead
   */
  async getDefaultChannel(): Promise<string> {
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

    // Check if default channel (stream) exists
    const streamResult = await this.pool.query(
      "SELECT id FROM streams WHERE workspace_id = $1 AND slug = 'general' AND stream_type = 'channel'",
      [workspaceId],
    )

    let streamId: string
    if (streamResult.rows.length === 0) {
      // Create default channel as a stream
      const streamIdResult = await this.pool.query(
        "INSERT INTO streams (id, workspace_id, stream_type, name, slug, description, visibility) VALUES ('stream_general', $1, 'channel', 'general', 'general', 'General discussion', 'public') RETURNING id",
        [workspaceId],
      )
      streamId = streamIdResult.rows[0].id
      logger.info("Created default channel (stream)")
    } else {
      streamId = streamResult.rows[0].id
    }

    return streamId
  }

  /**
   * Get workspace ID for a stream (channel)
   * Accepts either stream ID (stream_...) or stream slug (general)
   */
  async getWorkspaceIdForChannel(streamIdOrSlug: string): Promise<string | null> {
    // Try as ID first (starts with stream_)
    let result
    if (streamIdOrSlug.startsWith("stream_")) {
      result = await this.pool.query("SELECT workspace_id FROM streams WHERE id = $1", [streamIdOrSlug])
    } else {
      // Try as slug
      result = await this.pool.query("SELECT workspace_id FROM streams WHERE slug = $1", [streamIdOrSlug])
    }
    return result.rows[0]?.workspace_id || null
  }
}
