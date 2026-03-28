import { sql } from "../../db"
import type { Querier } from "../../db"

export interface UserApiKeyRow {
  id: string
  workspaceId: string
  userId: string
  name: string
  keyHash: string
  keyPrefix: string
  scopes: string[]
  lastUsedAt: Date | null
  expiresAt: Date | null
  revokedAt: Date | null
  createdAt: Date
}

const SELECT_FIELDS = `
  id, workspace_id, user_id, name, key_hash, key_prefix, scopes,
  last_used_at, expires_at, revoked_at, created_at
`

function mapRow(row: Record<string, unknown>): UserApiKeyRow {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    userId: row.user_id as string,
    name: row.name as string,
    keyHash: row.key_hash as string,
    keyPrefix: row.key_prefix as string,
    scopes: row.scopes as string[],
    lastUsedAt: row.last_used_at as Date | null,
    expiresAt: row.expires_at as Date | null,
    revokedAt: row.revoked_at as Date | null,
    createdAt: row.created_at as Date,
  }
}

export const UserApiKeyRepository = {
  async insert(
    db: Querier,
    params: {
      id: string
      workspaceId: string
      userId: string
      name: string
      keyHash: string
      keyPrefix: string
      scopes: string[]
      expiresAt: Date | null
    }
  ): Promise<UserApiKeyRow> {
    const result = await db.query<Record<string, unknown>>(sql`
      INSERT INTO user_api_keys (id, workspace_id, user_id, name, key_hash, key_prefix, scopes, expires_at)
      VALUES (
        ${params.id}, ${params.workspaceId}, ${params.userId}, ${params.name},
        ${params.keyHash}, ${params.keyPrefix}, ${params.scopes}, ${params.expiresAt}
      )
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return mapRow(result.rows[0])
  },

  async listByUser(db: Querier, workspaceId: string, userId: string): Promise<UserApiKeyRow[]> {
    const result = await db.query<Record<string, unknown>>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)}
      FROM user_api_keys
      WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
      ORDER BY created_at DESC
    `)
    return result.rows.map(mapRow)
  },

  async findById(db: Querier, workspaceId: string, id: string): Promise<UserApiKeyRow | null> {
    const result = await db.query<Record<string, unknown>>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)}
      FROM user_api_keys
      WHERE id = ${id} AND workspace_id = ${workspaceId}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async findActiveByPrefix(db: Querier, prefix: string): Promise<UserApiKeyRow[]> {
    const result = await db.query<Record<string, unknown>>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)}
      FROM user_api_keys
      WHERE key_prefix = ${prefix}
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())
    `)
    return result.rows.map(mapRow)
  },

  async revoke(db: Querier, workspaceId: string, id: string): Promise<boolean> {
    const result = await db.query(sql`
      UPDATE user_api_keys
      SET revoked_at = NOW()
      WHERE id = ${id} AND workspace_id = ${workspaceId} AND revoked_at IS NULL
    `)
    return (result.rowCount ?? 0) > 0
  },

  async revokeAllByUser(db: Querier, workspaceId: string, userId: string): Promise<number> {
    const result = await db.query(sql`
      UPDATE user_api_keys
      SET revoked_at = NOW()
      WHERE workspace_id = ${workspaceId} AND user_id = ${userId} AND revoked_at IS NULL
    `)
    return result.rowCount ?? 0
  },

  async touchLastUsed(db: Querier, id: string): Promise<void> {
    await db.query(sql`
      UPDATE user_api_keys SET last_used_at = NOW() WHERE id = ${id}
    `)
  },
}
