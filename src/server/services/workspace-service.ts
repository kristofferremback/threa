import { Pool } from "pg"
import { logger } from "../lib/logger"
import { generateId } from "../lib/id"

export interface Workspace {
  id: string
  name: string
  workos_organization_id: string | null
  created_at: Date
}

export class WorkspaceService {
  constructor(private pool: Pool) {}

  /**
   * Get or create workspace for a WorkOS organization
   * Ensures 1-to-1 coupling between workspaces and WorkOS organizations
   */
  async getOrCreateWorkspaceForOrganization(workosOrganizationId: string, workspaceName?: string): Promise<Workspace> {
    try {
      // Try to find existing workspace
      const existingResult = await this.pool.query<Workspace>(
        "SELECT id, name, workos_organization_id, created_at FROM workspaces WHERE workos_organization_id = $1",
        [workosOrganizationId],
      )

      const existing = existingResult.rows[0]
      if (existing) {
        return existing
      }

      // Create new workspace
      const workspaceId = generateId("ws")
      const name = workspaceName || `Workspace ${workosOrganizationId.slice(0, 8)}`

      await this.pool.query("INSERT INTO workspaces (id, name, workos_organization_id) VALUES ($1, $2, $3)", [
        workspaceId,
        name,
        workosOrganizationId,
      ])

      logger.info(
        { workspace_id: workspaceId, organization_id: workosOrganizationId },
        "Created workspace for organization",
      )

      const result = await this.pool.query<Workspace>(
        "SELECT id, name, workos_organization_id, created_at FROM workspaces WHERE id = $1",
        [workspaceId],
      )

      const workspace = result.rows[0]
      if (!workspace) {
        throw new Error("Failed to create workspace")
      }

      return workspace
    } catch (error) {
      logger.error({ err: error, organization_id: workosOrganizationId }, "Failed to get or create workspace")
      throw error
    }
  }

  /**
   * Get workspace by ID
   */
  async getWorkspace(workspaceId: string): Promise<Workspace | null> {
    try {
      const result = await this.pool.query<Workspace>(
        "SELECT id, name, workos_organization_id, created_at FROM workspaces WHERE id = $1",
        [workspaceId],
      )

      return result.rows[0] || null
    } catch (error) {
      logger.error({ err: error, workspace_id: workspaceId }, "Failed to get workspace")
      throw error
    }
  }

  /**
   * Get workspace by WorkOS organization ID
   */
  async getWorkspaceByOrganization(workosOrganizationId: string): Promise<Workspace | null> {
    try {
      const result = await this.pool.query<Workspace>(
        "SELECT id, name, workos_organization_id, created_at FROM workspaces WHERE workos_organization_id = $1",
        [workosOrganizationId],
      )

      return result.rows[0] || null
    } catch (error) {
      logger.error({ err: error, organization_id: workosOrganizationId }, "Failed to get workspace by organization")
      throw error
    }
  }

  /**
   * Ensure user is a member of workspace
   */
  async ensureWorkspaceMember(workspaceId: string, userId: string, role: string = "member"): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, user_id) DO UPDATE
         SET role = EXCLUDED.role`,
        [workspaceId, userId, role],
      )

      logger.debug({ workspace_id: workspaceId, user_id: userId, role }, "Workspace membership ensured")
    } catch (error) {
      logger.error({ err: error, workspace_id: workspaceId, user_id: userId }, "Failed to ensure workspace member")
      throw error
    }
  }

  /**
   * Get or create default channel for workspace
   * Returns channel ID
   */
  async getOrCreateDefaultChannel(workspaceId: string): Promise<string> {
    try {
      // Check if default channel exists
      const channelResult = await this.pool.query(
        "SELECT id FROM channels WHERE workspace_id = $1 AND name = '#general'",
        [workspaceId],
      )

      if (channelResult.rows.length > 0) {
        return channelResult.rows[0].id
      }

      // Create default channel
      const channelId = generateId("chan")
      await this.pool.query(
        "INSERT INTO channels (id, workspace_id, name, description) VALUES ($1, $2, '#general', 'General discussion')",
        [channelId, workspaceId],
      )

      logger.info({ workspace_id: workspaceId, channel_id: channelId }, "Created default channel")
      return channelId
    } catch (error) {
      logger.error({ err: error, workspace_id: workspaceId }, "Failed to get or create default channel")
      throw error
    }
  }
}
