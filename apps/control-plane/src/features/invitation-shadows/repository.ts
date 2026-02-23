import type { Querier } from "@threa/backend-common"

export interface InvitationShadowRow {
  id: string
  workspace_id: string
  email: string
  region: string
  status: string
  created_at: Date
  expires_at: Date
}

export const InvitationShadowRepository = {
  async findPendingByEmail(db: Querier, email: string): Promise<InvitationShadowRow[]> {
    const result = await db.query<InvitationShadowRow>(
      `SELECT id, workspace_id, email, region, status, created_at, expires_at
       FROM invitation_shadows
       WHERE email = $1 AND status = 'pending' AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [email.toLowerCase()]
    )
    return result.rows
  },

  async insert(
    db: Querier,
    shadow: { id: string; workspaceId: string; email: string; region: string; expiresAt: Date }
  ): Promise<InvitationShadowRow> {
    const result = await db.query<InvitationShadowRow>(
      `INSERT INTO invitation_shadows (id, workspace_id, email, region, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, workspace_id, email, region, status, created_at, expires_at`,
      [shadow.id, shadow.workspaceId, shadow.email.toLowerCase(), shadow.region, shadow.expiresAt]
    )
    return result.rows[0]
  },

  async updateStatus(db: Querier, id: string, status: string): Promise<boolean> {
    const result = await db.query("UPDATE invitation_shadows SET status = $1 WHERE id = $2", [status, id])
    return (result.rowCount ?? 0) > 0
  },
}
