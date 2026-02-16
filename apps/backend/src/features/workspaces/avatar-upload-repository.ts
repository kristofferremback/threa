import type { Querier } from "../../db"
import { sql } from "../../db"

interface AvatarUploadRow {
  id: string
  workspace_id: string
  member_id: string
  raw_s3_key: string
  replaces_avatar_url: string | null
  created_at: Date
}

export interface AvatarUpload {
  id: string
  workspaceId: string
  memberId: string
  rawS3Key: string
  replacesAvatarUrl: string | null
  createdAt: Date
}

function mapRow(row: AvatarUploadRow): AvatarUpload {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    memberId: row.member_id,
    rawS3Key: row.raw_s3_key,
    replacesAvatarUrl: row.replaces_avatar_url,
    createdAt: row.created_at,
  }
}

export const AvatarUploadRepository = {
  async insert(
    db: Querier,
    params: { id: string; workspaceId: string; memberId: string; rawS3Key: string; replacesAvatarUrl: string | null }
  ): Promise<AvatarUpload> {
    const result = await db.query<AvatarUploadRow>(sql`
      INSERT INTO avatar_uploads (id, workspace_id, member_id, raw_s3_key, replaces_avatar_url)
      VALUES (${params.id}, ${params.workspaceId}, ${params.memberId}, ${params.rawS3Key}, ${params.replacesAvatarUrl})
      RETURNING id, workspace_id, member_id, raw_s3_key, replaces_avatar_url, created_at
    `)
    return mapRow(result.rows[0])
  },

  async findById(db: Querier, id: string): Promise<AvatarUpload | null> {
    const result = await db.query<AvatarUploadRow>(sql`
      SELECT id, workspace_id, member_id, raw_s3_key, replaces_avatar_url, created_at
      FROM avatar_uploads WHERE id = ${id}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async findLatestForMember(db: Querier, memberId: string): Promise<AvatarUpload | null> {
    const result = await db.query<AvatarUploadRow>(sql`
      SELECT id, workspace_id, member_id, raw_s3_key, replaces_avatar_url, created_at
      FROM avatar_uploads WHERE member_id = ${memberId}
      ORDER BY created_at DESC LIMIT 1
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async deleteById(db: Querier, id: string): Promise<void> {
    await db.query(sql`DELETE FROM avatar_uploads WHERE id = ${id}`)
  },

  async deleteByMemberId(db: Querier, memberId: string): Promise<void> {
    await db.query(sql`DELETE FROM avatar_uploads WHERE member_id = ${memberId}`)
  },
}
