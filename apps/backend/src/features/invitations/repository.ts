import type { Querier } from "../../db"
import { sql } from "../../db"
import type { InvitationStatus, WorkspaceInvitationKind } from "@threa/types"

interface InvitationRow {
  id: string
  workspace_id: string
  kind: string
  email: string | null
  role: string
  invited_by: string
  workos_invitation_id: string | null
  token_hash: string | null
  note: string | null
  status: string
  created_at: Date
  expires_at: Date
  accepted_at: Date | null
  revoked_at: Date | null
}

export interface Invitation {
  id: string
  workspaceId: string
  kind: WorkspaceInvitationKind
  email: string | null
  role: "admin" | "member"
  invitedBy: string
  workosInvitationId: string | null
  tokenHash: string | null
  note: string | null
  status: InvitationStatus
  createdAt: Date
  expiresAt: Date
  acceptedAt: Date | null
  revokedAt: Date | null
}

export interface InsertEmailInvitationParams {
  id: string
  workspaceId: string
  email: string
  role: "admin" | "member"
  invitedBy: string
  expiresAt: Date
}

export interface InsertLinkInvitationParams {
  id: string
  workspaceId: string
  role: "admin" | "member"
  invitedBy: string
  tokenHash: string
  note: string | null
  expiresAt: Date
}

function mapRow(row: InvitationRow): Invitation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind as WorkspaceInvitationKind,
    email: row.email,
    role: row.role as Invitation["role"],
    invitedBy: row.invited_by,
    workosInvitationId: row.workos_invitation_id,
    tokenHash: row.token_hash,
    note: row.note,
    status: row.status as InvitationStatus,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
  }
}

const SELECT_FIELDS = `id, workspace_id, kind, email, role, invited_by, workos_invitation_id, token_hash, note, status, created_at, expires_at, accepted_at, revoked_at`

export const InvitationRepository = {
  async insert(db: Querier, params: InsertEmailInvitationParams): Promise<Invitation> {
    const result = await db.query<InvitationRow>(sql`
      INSERT INTO workspace_invitations (id, workspace_id, kind, email, role, invited_by, expires_at)
      VALUES (${params.id}, ${params.workspaceId}, 'email', ${params.email}, ${params.role}, ${params.invitedBy}, ${params.expiresAt})
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return mapRow(result.rows[0])
  },

  async insertLink(db: Querier, params: InsertLinkInvitationParams): Promise<Invitation> {
    const result = await db.query<InvitationRow>(sql`
      INSERT INTO workspace_invitations
        (id, workspace_id, kind, email, role, invited_by, token_hash, note, expires_at)
      VALUES
        (${params.id}, ${params.workspaceId}, 'link', NULL, ${params.role}, ${params.invitedBy},
         ${params.tokenHash}, ${params.note}, ${params.expiresAt})
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return mapRow(result.rows[0])
  },

  async findByTokenHash(db: Querier, tokenHash: string): Promise<Invitation | null> {
    const result = await db.query<InvitationRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)} FROM workspace_invitations
      WHERE token_hash = ${tokenHash} AND kind = 'link'
      LIMIT 1
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  /**
   * Atomic single-use claim: bind email + record claimer, only if the link is
   * still unclaimed (`email IS NULL AND status='pending'`). Returns the updated
   * row on success, null if another caller already claimed the token (INV-20).
   */
  async claimLinkByTokenHash(db: Querier, tokenHash: string, email: string): Promise<Invitation | null> {
    const result = await db.query<InvitationRow>(sql`
      UPDATE workspace_invitations
      SET email = ${email}
      WHERE token_hash = ${tokenHash}
        AND kind = 'link'
        AND status = 'pending'
        AND email IS NULL
        AND expires_at > NOW()
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async findById(db: Querier, id: string): Promise<Invitation | null> {
    const result = await db.query<InvitationRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)} FROM workspace_invitations WHERE id = ${id}
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

  /**
   * Dedup lookup for `sendInvitations`. Includes both email-kind invites and
   * already-claimed link invites (which now carry an email). Excludes unclaimed
   * link invites which have null emails.
   */
  async findPendingByEmailsAndWorkspace(db: Querier, emails: string[], workspaceId: string): Promise<Invitation[]> {
    if (emails.length === 0) return []

    const result = await db.query<InvitationRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)} FROM workspace_invitations
      WHERE email = ANY(${emails})
        AND workspace_id = ${workspaceId}
        AND status = 'pending'
        AND expires_at > NOW()
    `)
    return result.rows.map(mapRow)
  },

  async updateStatus(
    db: Querier,
    id: string,
    status: InvitationStatus,
    extra?: { acceptedAt?: Date; revokedAt?: Date; notExpiredAt?: Date }
  ): Promise<boolean> {
    const notExpiredAt = extra?.notExpiredAt ?? null
    const result = await db.query(sql`
      UPDATE workspace_invitations
      SET status = ${status},
          accepted_at = COALESCE(${extra?.acceptedAt ?? null}, accepted_at),
          revoked_at = COALESCE(${extra?.revokedAt ?? null}, revoked_at)
      WHERE id = ${id} AND status = 'pending'
        AND (${notExpiredAt}::timestamptz IS NULL OR expires_at > ${notExpiredAt})
    `)
    return (result.rowCount ?? 0) > 0
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
