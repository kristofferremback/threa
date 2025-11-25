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

  // ==========================================================================
  // Invitations
  // ==========================================================================

  /**
   * Create an invitation to a workspace
   */
  async createInvitation(
    workspaceId: string,
    email: string,
    invitedByUserId: string,
    role: "admin" | "member" | "guest" = "member",
    expiresInDays: number = 7,
  ): Promise<{ id: string; token: string; expiresAt: Date }> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      // Check seat limits
      await this.checkSeatLimit(client, workspaceId)

      // Check if user is already an active member
      const existingMember = await client.query(
        `SELECT wm.status FROM workspace_members wm
         INNER JOIN users u ON wm.user_id = u.id
         WHERE wm.workspace_id = $1 AND u.email = $2`,
        [workspaceId, email],
      )

      if (existingMember.rows[0]?.status === "active") {
        throw new Error("User is already a member of this workspace")
      }

      // Check for existing pending invitation
      const existingInvite = await client.query(
        `SELECT id FROM workspace_invitations
         WHERE workspace_id = $1 AND email = $2 AND status = 'pending'`,
        [workspaceId, email],
      )

      if (existingInvite.rows.length > 0) {
        // Revoke old invitation
        await client.query(
          `UPDATE workspace_invitations SET status = 'revoked', updated_at = NOW()
           WHERE id = $1`,
          [existingInvite.rows[0].id],
        )
      }

      // Generate invitation
      const invitationId = generateId("inv")
      const token = this.generateInviteToken()
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + expiresInDays)

      await client.query(
        `INSERT INTO workspace_invitations (id, workspace_id, email, role, token, invited_by_user_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [invitationId, workspaceId, email, role, token, invitedByUserId, expiresAt],
      )

      await client.query("COMMIT")

      logger.info({ workspace_id: workspaceId, email, invited_by: invitedByUserId }, "Invitation created")

      return { id: invitationId, token, expiresAt }
    } catch (error) {
      await client.query("ROLLBACK")
      logger.error({ err: error, workspace_id: workspaceId, email }, "Failed to create invitation")
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Get invitation by token
   */
  async getInvitationByToken(token: string): Promise<{
    id: string
    workspaceId: string
    workspaceName: string
    email: string
    role: string
    status: string
    expiresAt: Date
    invitedByEmail: string
  } | null> {
    const result = await this.pool.query(
      `SELECT i.id, i.workspace_id, w.name as workspace_name, i.email, i.role, i.status, i.expires_at,
              u.email as invited_by_email
       FROM workspace_invitations i
       INNER JOIN workspaces w ON i.workspace_id = w.id
       INNER JOIN users u ON i.invited_by_user_id = u.id
       WHERE i.token = $1`,
      [token],
    )

    const row = result.rows[0]
    if (!row) return null

    return {
      id: row.id,
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      email: row.email,
      role: row.role,
      status: row.status,
      expiresAt: row.expires_at,
      invitedByEmail: row.invited_by_email,
    }
  }

  /**
   * Accept an invitation
   */
  async acceptInvitation(
    token: string,
    userId: string,
    userEmail: string,
    userFirstName?: string,
    userLastName?: string,
  ): Promise<{ workspaceId: string }> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")

      // Get invitation
      const inviteRes = await client.query(
        `SELECT id, workspace_id, email, role, status, expires_at
         FROM workspace_invitations
         WHERE token = $1`,
        [token],
      )

      const invitation = inviteRes.rows[0]
      if (!invitation) {
        throw new Error("Invitation not found")
      }

      if (invitation.status !== "pending") {
        throw new Error(`Invitation has already been ${invitation.status}`)
      }

      if (new Date(invitation.expires_at) < new Date()) {
        await client.query(`UPDATE workspace_invitations SET status = 'expired', updated_at = NOW() WHERE id = $1`, [
          invitation.id,
        ])
        await client.query("COMMIT")
        throw new Error("Invitation has expired")
      }

      // Verify user email matches invitation
      if (userEmail?.toLowerCase() !== invitation.email.toLowerCase()) {
        throw new Error("This invitation was sent to a different email address")
      }

      // Build user's display name from first/last name or use email prefix
      const userName = [userFirstName, userLastName].filter(Boolean).join(" ") || userEmail.split("@")[0]

      // Ensure user exists in the users table (they may be new)
      await client.query(
        `INSERT INTO users (id, email, name, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email,
           name = COALESCE(NULLIF(EXCLUDED.name, ''), users.name),
           updated_at = NOW()`,
        [userId, userEmail, userName],
      )

      // Check seat limits again
      await this.checkSeatLimit(client, invitation.workspace_id)

      // Add user to workspace
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status, joined_at)
         VALUES ($1, $2, $3, 'active', NOW())
         ON CONFLICT (workspace_id, user_id) DO UPDATE
         SET role = EXCLUDED.role, status = 'active', joined_at = NOW()`,
        [invitation.workspace_id, userId, invitation.role],
      )

      // Mark invitation as accepted
      await client.query(
        `UPDATE workspace_invitations
         SET status = 'accepted', accepted_at = NOW(), accepted_by_user_id = $2, updated_at = NOW()
         WHERE id = $1`,
        [invitation.id, userId],
      )

      // Add user to default channel
      const defaultChannel = await client.query(
        "SELECT id FROM channels WHERE workspace_id = $1 AND slug = 'general'",
        [invitation.workspace_id],
      )

      if (defaultChannel.rows[0]) {
        await client.query(
          `INSERT INTO channel_members (channel_id, user_id, added_at, updated_at, notify_level, last_read_at)
           VALUES ($1, $2, NOW(), NOW(), 'default', NOW())
           ON CONFLICT (channel_id, user_id) DO NOTHING`,
          [defaultChannel.rows[0].id, userId],
        )
      }

      await client.query("COMMIT")

      logger.info({ invitation_id: invitation.id, user_id: userId }, "Invitation accepted")

      return { workspaceId: invitation.workspace_id }
    } catch (error) {
      await client.query("ROLLBACK")
      logger.error({ err: error, token }, "Failed to accept invitation")
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Revoke an invitation
   */
  async revokeInvitation(invitationId: string, revokedByUserId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE workspace_invitations
       SET status = 'revoked', updated_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING id`,
      [invitationId],
    )

    if (result.rows.length === 0) {
      throw new Error("Invitation not found or already processed")
    }

    logger.info({ invitation_id: invitationId, revoked_by: revokedByUserId }, "Invitation revoked")
  }

  /**
   * Get pending invitations for a workspace
   */
  async getPendingInvitations(workspaceId: string): Promise<
    Array<{
      id: string
      email: string
      role: string
      expiresAt: Date
      invitedByEmail: string
      createdAt: Date
    }>
  > {
    const result = await this.pool.query(
      `SELECT i.id, i.email, i.role, i.expires_at, i.created_at, u.email as invited_by_email
       FROM workspace_invitations i
       INNER JOIN users u ON i.invited_by_user_id = u.id
       WHERE i.workspace_id = $1 AND i.status = 'pending'
       ORDER BY i.created_at DESC`,
      [workspaceId],
    )

    return result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      expiresAt: row.expires_at,
      invitedByEmail: row.invited_by_email,
      createdAt: row.created_at,
    }))
  }

  private generateInviteToken(): string {
    // Generate a URL-safe random token
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    let token = ""
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return token
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
