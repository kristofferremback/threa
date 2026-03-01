import type { Querier } from "@threa/backend-common"

export interface InvitationShadowRow {
  id: string
  workspace_id: string
  email: string
  region: string
  status: string
  workos_invitation_id: string | null
  inviter_workos_user_id: string | null
  created_at: Date
  expires_at: Date
}

export interface PendingInvitationRow {
  id: string
  workspace_id: string
  workspace_name: string
  expires_at: Date
}

const SELECT_FIELDS = `id, workspace_id, email, region, status, workos_invitation_id, inviter_workos_user_id, created_at, expires_at`

export const InvitationShadowRepository = {
  async findById(db: Querier, id: string): Promise<InvitationShadowRow | null> {
    const result = await db.query<InvitationShadowRow>(
      `SELECT ${SELECT_FIELDS} FROM invitation_shadows WHERE id = $1`,
      [id]
    )
    return result.rows[0] ?? null
  },

  async findPendingByEmailWithWorkspace(db: Querier, email: string): Promise<PendingInvitationRow[]> {
    const result = await db.query<PendingInvitationRow>(
      `SELECT s.id, s.workspace_id, wr.name AS workspace_name, s.expires_at
       FROM invitation_shadows s
       JOIN workspace_registry wr ON wr.id = s.workspace_id
       WHERE s.email = $1 AND s.status = 'pending' AND s.expires_at > NOW()
       ORDER BY s.created_at DESC`,
      [email.toLowerCase()]
    )
    return result.rows
  },

  async insert(
    db: Querier,
    shadow: {
      id: string
      workspaceId: string
      email: string
      region: string
      expiresAt: Date
      inviterWorkosUserId?: string
    }
  ): Promise<InvitationShadowRow> {
    const result = await db.query<InvitationShadowRow>(
      `INSERT INTO invitation_shadows (id, workspace_id, email, region, expires_at, inviter_workos_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         expires_at = EXCLUDED.expires_at,
         inviter_workos_user_id = EXCLUDED.inviter_workos_user_id
       RETURNING ${SELECT_FIELDS}`,
      [
        shadow.id,
        shadow.workspaceId,
        shadow.email.toLowerCase(),
        shadow.region,
        shadow.expiresAt,
        shadow.inviterWorkosUserId ?? null,
      ]
    )
    return result.rows[0]
  },

  async setWorkosInvitationId(db: Querier, id: string, workosInvitationId: string): Promise<void> {
    await db.query("UPDATE invitation_shadows SET workos_invitation_id = $1 WHERE id = $2", [workosInvitationId, id])
  },

  /**
   * Atomically claim a pending shadow by transitioning to a terminal status.
   * Returns the full row if the claim succeeded, or null if the shadow doesn't
   * exist or was already claimed (INV-20: no select-then-act).
   */
  async claimPending(db: Querier, id: string, status: "accepted" | "revoked"): Promise<InvitationShadowRow | null> {
    const result = await db.query<InvitationShadowRow>(
      `UPDATE invitation_shadows SET status = $1
       WHERE id = $2 AND status = 'pending'
       RETURNING ${SELECT_FIELDS}`,
      [status, id]
    )
    return result.rows[0] ?? null
  },

  /** Revert an accepted claim back to pending (used when the regional call fails after an optimistic claim). */
  async revertClaim(db: Querier, id: string): Promise<boolean> {
    const result = await db.query(
      "UPDATE invitation_shadows SET status = 'pending' WHERE id = $1 AND status = 'accepted'",
      [id]
    )
    return (result.rowCount ?? 0) > 0
  },
}
