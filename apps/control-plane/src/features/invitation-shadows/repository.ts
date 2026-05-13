import type { Querier } from "@threa/backend-common"
import type { WorkspaceInvitableRole } from "@threa/types"

export interface InvitationShadowRow {
  id: string
  workspace_id: string
  kind: string
  email: string | null
  region: string
  status: string
  workos_invitation_id: string | null
  inviter_workos_user_id: string | null
  token_hash: string | null
  role_slug: WorkspaceInvitableRole
  created_at: Date
  expires_at: Date
}

export interface PendingInvitationRow {
  id: string
  workspace_id: string
  workspace_name: string
  expires_at: Date
}

export interface LinkLookupRow {
  id: string
  workspace_id: string
  workspace_name: string
  status: string
  expires_at: Date
}

const SELECT_FIELDS = `id, workspace_id, kind, email, region, status, workos_invitation_id, inviter_workos_user_id, token_hash, role_slug, created_at, expires_at`

export const InvitationShadowRepository = {
  async findById(db: Querier, id: string): Promise<InvitationShadowRow | null> {
    const result = await db.query<InvitationShadowRow>(
      `SELECT ${SELECT_FIELDS} FROM invitation_shadows WHERE id = $1`,
      [id]
    )
    return result.rows[0] ?? null
  },

  async listPendingByWorkspace(db: Querier, workspaceId: string): Promise<InvitationShadowRow[]> {
    const result = await db.query<InvitationShadowRow>(
      `SELECT ${SELECT_FIELDS} FROM invitation_shadows
       WHERE workspace_id = $1 AND status = 'pending' AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [workspaceId]
    )
    return result.rows
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
      region: string
      kind: "email" | "link"
      email: string | null
      tokenHash: string | null
      roleSlug: WorkspaceInvitableRole
      expiresAt: Date
      inviterWorkosUserId?: string
    }
  ): Promise<InvitationShadowRow> {
    const result = await db.query<InvitationShadowRow>(
      `INSERT INTO invitation_shadows (id, workspace_id, kind, email, region, expires_at, inviter_workos_user_id, token_hash, role_slug)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         expires_at = EXCLUDED.expires_at,
         inviter_workos_user_id = COALESCE(EXCLUDED.inviter_workos_user_id, invitation_shadows.inviter_workos_user_id)
       RETURNING ${SELECT_FIELDS}`,
      [
        shadow.id,
        shadow.workspaceId,
        shadow.kind,
        shadow.email ? shadow.email.toLowerCase() : null,
        shadow.region,
        shadow.expiresAt,
        shadow.inviterWorkosUserId ?? null,
        shadow.tokenHash,
        shadow.roleSlug,
      ]
    )
    return result.rows[0]
  },

  /**
   * Public-surface lookup by token hash. Returns minimal workspace metadata
   * for the unauthenticated /join page. Never exposes email, role, or note.
   */
  async findByTokenHashWithWorkspace(db: Querier, tokenHash: string): Promise<LinkLookupRow | null> {
    const result = await db.query<LinkLookupRow>(
      `SELECT s.id, s.workspace_id, wr.name AS workspace_name, s.status, s.expires_at
       FROM invitation_shadows s
       JOIN workspace_registry wr ON wr.id = s.workspace_id
       WHERE s.token_hash = $1 AND s.kind = 'link'
       LIMIT 1`,
      [tokenHash]
    )
    return result.rows[0] ?? null
  },

  /** Bind email + workosInvitationId on a previously-unbound link shadow. */
  async setEmailFromClaim(
    db: Querier,
    id: string,
    email: string,
    workosInvitationId: string | null
  ): Promise<InvitationShadowRow | null> {
    const result = await db.query<InvitationShadowRow>(
      `UPDATE invitation_shadows
       SET email = $1,
           workos_invitation_id = COALESCE($2, workos_invitation_id)
       WHERE id = $3 AND kind = 'link'
       RETURNING ${SELECT_FIELDS}`,
      [email.toLowerCase(), workosInvitationId, id]
    )
    return result.rows[0] ?? null
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
}
