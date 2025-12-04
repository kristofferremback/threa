import { Pool } from "pg"
import { withTransaction } from "../lib/db"
import { logger } from "../lib/logger"
import { generateId } from "../lib/id"
import type { Workspace, WorkspaceMember } from "../lib/types"
import { publishOutboxEvent, OutboxEventType } from "../lib/outbox-events"
import { randomUUID } from "node:crypto"

export class WorkspaceService {
  constructor(private pool: Pool) {}

  /**
   * Create a new workspace
   */
  async createWorkspace(name: string, creatorUserId: string): Promise<Workspace> {
    const workspaceId = generateId("ws")
    const slug = this.generateSlug(name) + "-" + workspaceId.slice(-6)

    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO workspaces (id, name, slug, plan_tier, seat_limit)
         VALUES ($1, $2, $3, 'free', 5)`,
        [workspaceId, name, slug],
      )
    })

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
  }

  /**
   * Get or create workspace for a WorkOS organization
   * Ensures 1-to-1 coupling between workspaces and WorkOS organizations
   */
  async getOrCreateWorkspaceForOrganization(workosOrganizationId: string, workspaceName?: string): Promise<Workspace> {
    return withTransaction(this.pool, async (client) => {
      // Try to find existing workspace
      const existingResult = await client.query<Workspace>(
        `SELECT id, name, slug, workos_organization_id, stripe_customer_id, plan_tier, billing_status, seat_limit, ai_budget_limit, created_at
         FROM workspaces
         WHERE workos_organization_id = $1`,
        [workosOrganizationId],
      )

      const existing = existingResult.rows[0]
      if (existing) {
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

      logger.info(
        { workspace_id: workspaceId, organization_id: workosOrganizationId },
        "Created workspace for organization",
      )

      const result = await client.query<Workspace>(
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
    })
  }

  /**
   * Get workspace by ID
   */
  async getWorkspace(workspaceId: string): Promise<Workspace | null> {
    const result = await this.pool.query<Workspace>(
      `SELECT id, name, slug, workos_organization_id, stripe_customer_id, plan_tier, billing_status, seat_limit, ai_budget_limit, created_at
       FROM workspaces
       WHERE id = $1`,
      [workspaceId],
    )

    return result.rows[0] || null
  }

  /**
   * Get workspace by WorkOS organization ID
   */
  async getWorkspaceByOrganization(workosOrganizationId: string): Promise<Workspace | null> {
    const result = await this.pool.query<Workspace>(
      `SELECT id, name, slug, workos_organization_id, stripe_customer_id, plan_tier, billing_status, seat_limit, ai_budget_limit, created_at
       FROM workspaces
       WHERE workos_organization_id = $1`,
      [workosOrganizationId],
    )

    return result.rows[0] || null
  }

  /**
   * Ensure user is a member of workspace with seat checking
   */
  async ensureWorkspaceMember(workspaceId: string, userId: string, role: string = "member"): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      // Check if already a member
      const existingMember = await client.query(
        "SELECT status FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
        [workspaceId, userId],
      )

      const wasInactive = existingMember.rows.length > 0 && existingMember.rows[0].status !== "active"
      const isNewMember = existingMember.rows.length === 0

      if (existingMember.rows.length > 0) {
        // Update role if needed, maintain status
        if (wasInactive) {
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

      // Publish event for new or reactivated members
      if (isNewMember || wasInactive) {
        // Get user info for the event
        const userResult = await client.query<{ email: string; name: string | null }>(
          "SELECT email, name FROM users WHERE id = $1",
          [userId],
        )
        const user = userResult.rows[0]

        if (user) {
          await publishOutboxEvent(client, OutboxEventType.WORKSPACE_MEMBER_ADDED, {
            workspace_id: workspaceId,
            user_id: userId,
            user_email: user.email,
            user_name: user.name,
            role,
          })
        }
      }

      logger.debug({ workspace_id: workspaceId, user_id: userId, role }, "Workspace membership ensured")
    })
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
   * Returns stream ID
   */
  async getOrCreateDefaultChannel(workspaceId: string): Promise<string> {
    // Check if default channel exists (as a stream)
    const streamResult = await this.pool.query(
      "SELECT id FROM streams WHERE workspace_id = $1 AND slug = 'general' AND stream_type = 'channel'",
      [workspaceId],
    )

    if (streamResult.rows.length > 0) {
      return streamResult.rows[0].id
    }

    // Create default channel (as a stream)
    const streamId = generateId("stream")
    await this.pool.query(
      `INSERT INTO streams (id, workspace_id, stream_type, name, slug, description, visibility)
       VALUES ($1, $2, 'channel', 'general', 'general', 'General discussion', 'public')`,
      [streamId, workspaceId],
    )

    logger.info({ workspace_id: workspaceId, stream_id: streamId }, "Created default channel")
    return streamId
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
    const invitationId = generateId("inv")
    const token = this.generateInviteToken()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + expiresInDays)

    await withTransaction(this.pool, async (client) => {
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

      await client.query(
        `INSERT INTO workspace_invitations (id, workspace_id, email, role, token, invited_by_user_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [invitationId, workspaceId, email, role, token, invitedByUserId, expiresAt],
      )

      // Get inviter email for the event
      const inviterResult = await client.query<{ email: string }>("SELECT email FROM users WHERE id = $1", [
        invitedByUserId,
      ])
      const inviterEmail = inviterResult.rows[0]?.email || "unknown"

      // Publish invitation created event
      await publishOutboxEvent(client, OutboxEventType.INVITATION_CREATED, {
        invitation_id: invitationId,
        workspace_id: workspaceId,
        email,
        role,
        invited_by_user_id: invitedByUserId,
        invited_by_email: inviterEmail,
        expires_at: expiresAt.toISOString(),
      })
    })

    logger.info({ workspace_id: workspaceId, email, invited_by: invitedByUserId }, "Invitation created")

    return { id: invitationId, token, expiresAt }
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
    return withTransaction(this.pool, async (client) => {
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

      // Add user to default channel (stream)
      const defaultStream = await client.query(
        "SELECT id FROM streams WHERE workspace_id = $1 AND slug = 'general' AND stream_type = 'channel'",
        [invitation.workspace_id],
      )

      if (defaultStream.rows[0]) {
        await client.query(
          `INSERT INTO stream_members (stream_id, user_id, role, joined_at, last_read_at)
           VALUES ($1, $2, 'member', NOW(), NOW())
           ON CONFLICT (stream_id, user_id) DO NOTHING`,
          [defaultStream.rows[0].id, userId],
        )
      }

      // Publish workspace member added event
      await publishOutboxEvent(client, OutboxEventType.WORKSPACE_MEMBER_ADDED, {
        workspace_id: invitation.workspace_id,
        user_id: userId,
        user_email: userEmail,
        user_name: userName,
        role: invitation.role,
      })

      // Publish invitation accepted event
      await publishOutboxEvent(client, OutboxEventType.INVITATION_ACCEPTED, {
        invitation_id: invitation.id,
        workspace_id: invitation.workspace_id,
        user_id: userId,
        user_email: userEmail,
        user_name: userName,
        role: invitation.role,
      })

      logger.info({ invitation_id: invitation.id, user_id: userId }, "Invitation accepted")

      return { workspaceId: invitation.workspace_id }
    })
  }

  /**
   * Revoke an invitation
   */
  async revokeInvitation(invitationId: string, revokedByUserId: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      // Get invitation details before revoking
      const inviteResult = await client.query<{ workspace_id: string; email: string }>(
        `SELECT workspace_id, email FROM workspace_invitations WHERE id = $1 AND status = 'pending'`,
        [invitationId],
      )

      if (inviteResult.rows.length === 0) {
        throw new Error("Invitation not found or already processed")
      }

      const invitation = inviteResult.rows[0]

      await client.query(
        `UPDATE workspace_invitations
         SET status = 'revoked', updated_at = NOW()
         WHERE id = $1`,
        [invitationId],
      )

      // Publish invitation revoked event
      await publishOutboxEvent(client, OutboxEventType.INVITATION_REVOKED, {
        invitation_id: invitationId,
        workspace_id: invitation.workspace_id,
        email: invitation.email,
        revoked_by_user_id: revokedByUserId,
      })

      logger.info({ invitation_id: invitationId, revoked_by: revokedByUserId }, "Invitation revoked")
    })
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
    return randomUUID().replaceAll("-", "")
  }

  private generateSlug(name: string): string {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "") || "workspace"
    )
  }

  // ==========================================================================
  // Workspace Profile Methods
  // ==========================================================================

  /**
   * Get a user's profile for a specific workspace
   */
  async getWorkspaceProfile(
    workspaceId: string,
    userId: string,
  ): Promise<{
    displayName: string | null
    title: string | null
    avatarUrl: string | null
    bio: string | null
    profileManagedBySso: boolean
  } | null> {
    // First check if user is a member
    const memberResult = await this.pool.query(
      `SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId],
    )

    if (memberResult.rows.length === 0) return null

    // Get profile (may not exist yet)
    const result = await this.pool.query(
      `SELECT display_name, title, avatar_url, bio, profile_managed_by_sso
       FROM workspace_profiles
       WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId],
    )

    if (result.rows.length === 0) {
      // No profile yet - return empty profile
      return {
        displayName: null,
        title: null,
        avatarUrl: null,
        bio: null,
        profileManagedBySso: false,
      }
    }

    const row = result.rows[0]
    return {
      displayName: row.display_name,
      title: row.title,
      avatarUrl: row.avatar_url,
      bio: row.bio,
      profileManagedBySso: row.profile_managed_by_sso || false,
    }
  }

  /**
   * Update a user's profile for a specific workspace (upsert)
   * Will fail if profile is managed by SSO
   */
  async updateWorkspaceProfile(
    workspaceId: string,
    userId: string,
    updates: { displayName?: string; title?: string; avatarUrl?: string; bio?: string },
  ): Promise<boolean> {
    await withTransaction(this.pool, async (client) => {
      // Check if user is a member
      const memberResult = await client.query(
        `SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, userId],
      )

      if (memberResult.rows.length === 0) {
        throw new Error("User is not a member of this workspace")
      }

      // Check if profile is managed by SSO
      const profileResult = await client.query(
        `SELECT profile_managed_by_sso FROM workspace_profiles WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, userId],
      )

      if (profileResult.rows.length > 0 && profileResult.rows[0].profile_managed_by_sso) {
        throw new Error("Profile is managed by SSO and cannot be edited")
      }

      // Upsert the profile
      await client.query(
        `INSERT INTO workspace_profiles (workspace_id, user_id, display_name, title, avatar_url, bio, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET
           display_name = COALESCE($3, workspace_profiles.display_name),
           title = COALESCE($4, workspace_profiles.title),
           avatar_url = COALESCE($5, workspace_profiles.avatar_url),
           bio = COALESCE($6, workspace_profiles.bio),
           updated_at = NOW()`,
        [workspaceId, userId, updates.displayName, updates.title, updates.avatarUrl, updates.bio],
      )

      // Publish profile updated event
      await publishOutboxEvent(client, OutboxEventType.USER_PROFILE_UPDATED, {
        workspace_id: workspaceId,
        user_id: userId,
        display_name: updates.displayName,
        title: updates.title,
        avatar_url: updates.avatarUrl,
      })

      logger.info({ workspaceId, userId, updates }, "Workspace profile updated")
    })

    return true
  }

  /**
   * Check if user needs to set up their profile for this workspace
   */
  async needsProfileSetup(workspaceId: string, userId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT wp.display_name, wp.profile_managed_by_sso
       FROM workspace_members wm
       LEFT JOIN workspace_profiles wp ON wm.workspace_id = wp.workspace_id AND wm.user_id = wp.user_id
       WHERE wm.workspace_id = $1 AND wm.user_id = $2`,
      [workspaceId, userId],
    )

    if (result.rows.length === 0) return false // Not a member

    const row = result.rows[0]
    // Needs setup if: not SSO-managed AND display_name is null or empty
    const isSsoManaged = row.profile_managed_by_sso || false
    const hasDisplayName = row.display_name && row.display_name.trim() !== ""
    return !isSsoManaged && !hasDisplayName
  }
}
