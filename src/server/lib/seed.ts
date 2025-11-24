import { Pool } from "pg"
import { logger } from "./logger"
import { generateId } from "./id"

/**
 * Seed script for local development
 * Creates a default workspace with a test user and #general channel
 */
export const seedDatabase = async (pool: Pool) => {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    // Check if seed data already exists
    const existingWorkspace = await client.query("SELECT id FROM workspaces WHERE slug = 'dev-workspace' LIMIT 1")

    if (existingWorkspace.rows.length > 0) {
      logger.info("Seed data already exists, skipping")
      await client.query("COMMIT")
      return
    }

    // Create test workspace
    const workspaceId = generateId("ws")
    await client.query(
      `INSERT INTO workspaces (id, name, slug, plan_tier, seat_limit)
       VALUES ($1, $2, $3, 'free', 5)`,
      [workspaceId, "Dev Workspace", "dev-workspace"],
    )

    // Create test user
    const userId = generateId("usr")
    await client.query(
      `INSERT INTO users (id, email, name)
       VALUES ($1, $2, $3)`,
      [userId, "dev@example.com", "Dev User"],
    )

    // Add user as admin to workspace
    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status)
       VALUES ($1, $2, 'admin', 'active')`,
      [workspaceId, userId],
    )

    // Create default #general channel
    const channelId = generateId("chan")
    await client.query(
      `INSERT INTO channels (id, workspace_id, name, slug, description, visibility)
       VALUES ($1, $2, $3, $4, $5, 'public')`,
      [channelId, workspaceId, "#general", "general", "General discussion"],
    )

    await client.query("COMMIT")

    logger.info(
      {
        workspace_id: workspaceId,
        user_id: userId,
        channel_id: channelId,
      },
      "Seed data created successfully",
    )
  } catch (error) {
    await client.query("ROLLBACK")
    logger.error({ err: error }, "Failed to seed database")
    throw error
  } finally {
    client.release()
  }
}
