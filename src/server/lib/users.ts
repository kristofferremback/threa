import { pool } from "./db"
import { logger } from "./logger"

export interface WorkOSUser {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
}

/**
 * Ensure user exists in database (upsert)
 * Syncs user data from WorkOS to our database
 */
export const ensureUser = async (workosUser: WorkOSUser): Promise<void> => {
  try {
    const name = [workosUser.firstName, workosUser.lastName].filter(Boolean).join(" ") || workosUser.email

    await pool.query(
      `INSERT INTO users (id, email, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE
       SET email = EXCLUDED.email, name = EXCLUDED.name`,
      [workosUser.id, workosUser.email, name]
    )

    logger.debug({ user_id: workosUser.id, email: workosUser.email }, "User synced to database")
  } catch (error) {
    logger.error({ err: error, user_id: workosUser.id }, "Failed to sync user")
    throw error
  }
}

/**
 * Get or create default workspace and channel for MVP
 * Returns channel ID
 */
export const getDefaultChannel = async (): Promise<string> => {
  try {
    // Check if default workspace exists
    const workspaceResult = await pool.query("SELECT id FROM workspaces WHERE id = 'ws_default'")

    let workspaceId: string
    if (workspaceResult.rows.length === 0) {
      // Create default workspace
      await pool.query("INSERT INTO workspaces (id, name) VALUES ('ws_default', 'Default Workspace')")
      workspaceId = "ws_default"
      logger.info("Created default workspace")
    } else {
      workspaceId = workspaceResult.rows[0].id
    }

    // Check if default channel exists
    const channelResult = await pool.query(
      "SELECT id FROM channels WHERE workspace_id = $1 AND name = '#general'",
      [workspaceId]
    )

    let channelId: string
    if (channelResult.rows.length === 0) {
      // Create default channel
      const channelIdResult = await pool.query(
        "INSERT INTO channels (id, workspace_id, name, description) VALUES ('chan_general', $1, '#general', 'General discussion') RETURNING id",
        [workspaceId]
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

