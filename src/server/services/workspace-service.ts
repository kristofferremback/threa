import { Pool } from "pg"
import { logger } from "../lib/logger"
import { generateId } from "../lib/id"
import type { Workspace, WorkspaceMember } from "../lib/types"

export class WorkspaceService {
  constructor(private pool: Pool) {}

  /**
   * Create a new workspace
   */
  async createWorkspace(name: string, creatorUserId: string): Promise<Workspace> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      const workspaceId = generateId("ws")
      const slug = this.generateSlug(name) + "-" + workspaceId.slice(-6)

      await client.query(
        `INSERT INTO workspaces (id, name, slug, plan_tier, seat_limit)
         VALUES ($1, $2, $3, 'free', 5)`,
        [workspaceId, name, slug],
      )

      // Create default channel
      const channelId = generateId("chan")
      await client.query(
        `INSERT INTO channels (id, workspace_id, name, slug, description, visibility)
         VALUES ($1, $2, 'general', 'general', 'General discussion', 'public')`,
        [channelId, workspaceId],
      )

      await client.query("COMMIT")

      logger.info({ workspace_id: workspaceId, creator: creatorUserId }, "Created workspace")

      const result = await this.pool.query<Workspace>(
        `SELECT id, name, slug, workos_organization_id, stripe_customer_id, plan_tier, billing_status, seat_limit, ai_budget_limit, created_at
         FROM workspaces
         WHERE id = $1`,
        [workspaceId],
      )

      const workspace = result.rows[0]
      if (!workspace) {
        throw new Error("Failed to create workspace")
      }

      return workspace
    } catch (error) {
      await client.query("ROLLBACK")
      logger.error({ err: error }, "Failed to create workspace")
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Get or create workspace for a WorkOS organization
   * Ensures 1-to-1 coupling between workspaces and WorkOS organizations
   */
  async getOrCreateWorkspaceForOrganization(workosOrganizationId: string, workspaceName?: string): Promise<Workspace> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      // Try to find existing workspace
      const existingResult = await client.query<Workspace>(
        `SELECT id, name, slug, workos_organization_id, stripe_customer_id, plan_tier, billing_status, seat_limit, ai_budget_limit, created_at
         FROM workspaces
         WHERE workos_organization_id = $1`,
        [workosOrganizationId],
      )

      const existing = existingResult.rows[0]
      if (existing) {
        await client.query("COMMIT")
        return existing
      }

      // Create new workspace
      const workspaceId = generateId("ws")
      const name = workspaceName || `Workspace ${workosOrganizationId.slice(0, 8)}`
      const slug = this.generateSlug(name)

      await client.query(
        `INSERT INTO workspaces (id, name, slug, workos_organization_id, plan_tier, seat_limit)
         VALUES ($1, $2, $3, $4, 'free', 5)`, // Default seat limit for free tier
        [workspaceId, name, slug, workosOrganizationId],
      )

      // Create default channel immediately
      const channelId = generateId("chan")
      await client.query(
        `INSERT INTO channels (id, workspace_id, name, slug, description, visibility)
         VALUES ($1, $2, '#general', 'general', 'General discussion', 'public')`,
        [channelId, workspaceId],
      )

      await client.query("COMMIT")

      logger.info(
        { workspace_id: workspaceId, organization_id: workosOrganizationId },
        "Created workspace for organization",
      )

      const result = await this.pool.query<Workspace>(
        `SELECT id, name, slug, workos_organization_id, stripe_customer_id, plan_tier, billing_status, seat_limit, ai_budget_limit, created_at
         FROM workspaces
         WHERE id = $1`,
        [workspaceId],
      )

      const workspace = result.rows[0]
      if (!workspace) {
        throw new Error("Failed to create workspace")
      }

      return workspace
    } catch (error) {
      await client.query("ROLLBACK")
      logger.error({ err: error, organization_id: workosOrganizationId }, "Failed to get or create workspace")
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Get workspace by ID
   */
  async getWorkspace(workspaceId: string): Promise<Workspace | null> {
    try {
      const result = await this.pool.query<Workspace>(
        `SELECT id, name, slug, workos_organization_id, stripe_customer_id, plan_tier, billing_status, seat_limit, ai_budget_limit, created_at
         FROM workspaces
         WHERE id = $1`,
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
        `SELECT id, name, slug, workos_organization_id, stripe_customer_id, plan_tier, billing_status, seat_limit, ai_budget_limit, created_at
         FROM workspaces
         WHERE workos_organization_id = $1`,
        [workosOrganizationId],
      )

      return result.rows[0] || null
    } catch (error) {
      logger.error({ err: error, organization_id: workosOrganizationId }, "Failed to get workspace by organization")
      throw error
    }
  }

  /**
   * Ensure user is a member of workspace with seat checking
   */
  async ensureWorkspaceMember(workspaceId: string, userId: string, role: string = "member"): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      // Check if already a member
      const existingMember = await client.query(
        "SELECT status FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
        [workspaceId, userId],
      )

      if (existingMember.rows.length > 0) {
        // Update role if needed, maintain status
        if (existingMember.rows[0].status !== "active") {
          // If reactivating, check limits
          await this.checkSeatLimit(client, workspaceId)
        }

        await client.query(
          `UPDATE workspace_members SET role = $3, status = 'active', joined_at = COALESCE(joined_at, NOW())
           WHERE workspace_id = $1 AND user_id = $2`,
          [workspaceId, userId, role],
        )
      } else {
        // New member - Check limits first
        await this.checkSeatLimit(client, workspaceId)

        await client.query(
          `INSERT INTO workspace_members (workspace_id, user_id, role, status, joined_at)
           VALUES ($1, $2, $3, 'active', NOW())`,
          [workspaceId, userId, role],
        )
      }

      await client.query("COMMIT")
      logger.debug({ workspace_id: workspaceId, user_id: userId, role }, "Workspace membership ensured")
    } catch (error) {
      await client.query("ROLLBACK")
      logger.error({ err: error, workspace_id: workspaceId, user_id: userId }, "Failed to ensure workspace member")
      throw error
    } finally {
      client.release()
    }
  }

  private async checkSeatLimit(client: any, workspaceId: string): Promise<void> {
    const workspaceRes = await client.query("SELECT seat_limit FROM workspaces WHERE id = $1", [workspaceId])
    const seatLimit = workspaceRes.rows[0]?.seat_limit

    if (seatLimit !== null) {
      const countRes = await client.query(
        "SELECT COUNT(*) as count FROM workspace_members WHERE workspace_id = $1 AND status = 'active'",
        [workspaceId],
      )
      const currentCount = parseInt(countRes.rows[0].count)

      if (currentCount >= seatLimit) {
        throw new Error(`Workspace seat limit reached (${seatLimit})`)
      }
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
        "SELECT id FROM channels WHERE workspace_id = $1 AND slug = 'general'",
        [workspaceId],
      )

      if (channelResult.rows.length > 0) {
        return channelResult.rows[0].id
      }

      // Create default channel
      const channelId = generateId("chan")
      await this.pool.query(
        `INSERT INTO channels (id, workspace_id, name, slug, description, visibility)
         VALUES ($1, $2, '#general', 'general', 'General discussion', 'public')`,
        [channelId, workspaceId],
      )

      logger.info({ workspace_id: workspaceId, channel_id: channelId }, "Created default channel")
      return channelId
    } catch (error) {
      logger.error({ err: error, workspace_id: workspaceId }, "Failed to get or create default channel")
      throw error
    }
  }

  /**
   * Invite a user to a workspace
   */
  async inviteUserToWorkspace(
    workspaceId: string,
    email: string,
    role: "admin" | "member" = "member",
    invitedByUserId: string,
  ): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      // Check seat limits
      await this.checkSeatLimit(client, workspaceId)

      // Check if user already exists in users table
      const userRes = await client.query("SELECT id FROM users WHERE email = $1", [email])
      let userId = userRes.rows[0]?.id

      if (!userId) {
        // Pre-create user if they don't exist yet
        userId = generateId("usr")
        // We'll assume name will be filled in when they actually sign up/in via WorkOS
        // For now, use email as placeholder name
        await client.query("INSERT INTO users (id, email, name) VALUES ($1, $2, $3)", [
          userId,
          email,
          email.split("@")[0],
        ])
      }

      // Add to workspace_members with 'invited' status
      // If they are already a member, this might be a re-invite or upgrade
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status, invited_at)
         VALUES ($1, $2, $3, 'invited', NOW())
         ON CONFLICT (workspace_id, user_id) DO UPDATE
         SET role = EXCLUDED.role,
             status = CASE
               WHEN workspace_members.status = 'active' THEN 'active' -- Don't demote active users to invited
               ELSE 'invited'
             END,
             invited_at = COALESCE(workspace_members.invited_at, NOW())`,
        [workspaceId, userId, role],
      )

      await client.query("COMMIT")
      logger.info({ workspace_id: workspaceId, email, invited_by: invitedByUserId }, "User invited to workspace")

      // TODO: Trigger email notification via outbox event
    } catch (error) {
      await client.query("ROLLBACK")
      logger.error({ err: error, workspace_id: workspaceId, email }, "Failed to invite user")
      throw error
    } finally {
      client.release()
    }
  }

  private generateSlug(name: string): string {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "") || "workspace"
    )
  }
}
