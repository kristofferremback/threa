import type { Querier } from "../../db"
import { sql } from "../../db"
import type { InvitationStatus } from "@threa/types"

interface InvitationRow {
  id: string
  workspace_id: string
  email: string
  role: string
  invited_by: string
  workos_invitation_id: string | null
  status: string
  created_at: Date
  expires_at: Date
  accepted_at: Date | null
  revoked_at: Date | null
}

export interface Invitation {
  id: string
  workspaceId: string
  email: string
  role: "admin" | "member"
  invitedBy: string
  workosInvitationId: string | null
  status: InvitationStatus
  createdAt: Date
  expiresAt: Date
  acceptedAt: Date | null
  revokedAt: Date | null
}

export interface InsertInvitationParams {
  id: string
  workspaceId: string
  email: string
  role: "admin" | "member"
  invitedBy: string
  expiresAt: Date
}

function mapRow(row: InvitationRow): Invitation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    email: row.email,
    role: row.role as Invitation["role"],
    invitedBy: row.invited_by,
    workosInvitationId: row.workos_invitation_id,
    status: row.status as InvitationStatus,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
  }
}

const SELECT_FIELDS = `id, workspace_id, email, role, invited_by, workos_invitation_id, status, created_at, expires_at, accepted_at, revoked_at`

export const InvitationRepository = {
  async insert(db: Querier, params: InsertInvitationParams): Promise<Invitation> {
    const result = await db.query<InvitationRow>(sql`
      INSERT INTO workspace_invitations (id, workspace_id, email, role, invited_by, expires_at)
      VALUES (${params.id}, ${params.workspaceId}, ${params.email}, ${params.role}, ${params.invitedBy}, ${params.expiresAt})
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return mapRow(result.rows[0])
  },

  async findById(db: Querier, id: string): Promise<Invitation | null> {
    const result = await db.query<InvitationRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)} FROM workspace_invitations WHERE id = ${id}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async findByWorkosInvitationId(db: Querier, workosId: string): Promise<Invitation | null> {
    const result = await db.query<InvitationRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)} FROM workspace_invitations
      WHERE workos_invitation_id = ${workosId}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async listByWorkspace(
    db: Querier,
    workspaceId: string,
    filters?: { status?: InvitationStatus }
  ): Promise<Invitation[]> {
    if (filters?.status) {
      const result = await db.query<InvitationRow>(sql`
        SELECT ${sql.raw(SELECT_FIELDS)} FROM workspace_invitations
        WHERE workspace_id = ${workspaceId} AND status = ${filters.status}
        ORDER BY created_at DESC
      `)
      return result.rows.map(mapRow)
    }
    const result = await db.query<InvitationRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)} FROM workspace_invitations
      WHERE workspace_id = ${workspaceId}
      ORDER BY created_at DESC
    `)
    return result.rows.map(mapRow)
  },

  async findPendingByEmail(db: Querier, email: string): Promise<Invitation[]> {
    const result = await db.query<InvitationRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)} FROM workspace_invitations
      WHERE email = ${email} AND status = 'pending' AND expires_at > NOW()
      ORDER BY created_at DESC
    `)
    return result.rows.map(mapRow)
  },

  async findPendingByEmailAndWorkspace(db: Querier, email: string, workspaceId: string): Promise<Invitation | null> {
    const result = await db.query<InvitationRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)} FROM workspace_invitations
      WHERE email = ${email} AND workspace_id = ${workspaceId} AND status = 'pending' AND expires_at > NOW()
      LIMIT 1
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async findPendingByEmailsAndWorkspace(db: Querier, emails: string[], workspaceId: string): Promise<Invitation[]> {
    if (emails.length === 0) return []

    const result = await db.query<InvitationRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)} FROM workspace_invitations
      WHERE email = ANY(${emails}) AND workspace_id = ${workspaceId} AND status = 'pending' AND expires_at > NOW()
    `)
    return result.rows.map(mapRow)
  },

  async updateStatus(
    db: Querier,
    id: string,
    status: InvitationStatus,
    extra?: { acceptedAt?: Date; revokedAt?: Date; workosInvitationId?: string }
  ): Promise<boolean> {
    // Uses WHERE status = 'pending' per INV-20 to prevent race conditions
    const result = await db.query(sql`
      UPDATE workspace_invitations
      SET status = ${status},
          accepted_at = COALESCE(${extra?.acceptedAt ?? null}, accepted_at),
          revoked_at = COALESCE(${extra?.revokedAt ?? null}, revoked_at)
      WHERE id = ${id} AND status = 'pending'
    `)
    return (result.rowCount ?? 0) > 0
  },

  async setWorkosInvitationId(db: Querier, id: string, workosInvitationId: string): Promise<void> {
    await db.query(sql`
      UPDATE workspace_invitations SET workos_invitation_id = ${workosInvitationId}
      WHERE id = ${id}
    `)
  },

  async markExpired(db: Querier, workspaceId: string): Promise<number> {
    const result = await db.query(sql`
      UPDATE workspace_invitations
      SET status = 'expired'
      WHERE workspace_id = ${workspaceId} AND status = 'pending' AND expires_at < NOW()
    `)
    return result.rowCount ?? 0
  },
}
