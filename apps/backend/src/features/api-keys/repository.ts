import type { Querier } from "../../db"
import { sql } from "../../db"
import { apiKeyChannelAccessId } from "../../lib/id"

export const ApiKeyChannelAccessRepository = {
  async getGrantedStreamIds(db: Querier, workspaceId: string, apiKeyId: string): Promise<string[]> {
    const result = await db.query<{ stream_id: string }>(sql`
      SELECT a.stream_id FROM api_key_channel_access a
      JOIN streams s ON s.id = a.stream_id
      WHERE a.workspace_id = ${workspaceId}
        AND a.api_key_id = ${apiKeyId}
        AND s.archived_at IS NULL
    `)
    return result.rows.map((r) => r.stream_id)
  },

  async grantAccess(
    db: Querier,
    params: { workspaceId: string; apiKeyId: string; streamId: string; grantedBy: string }
  ): Promise<void> {
    const id = apiKeyChannelAccessId()
    await db.query(sql`
      INSERT INTO api_key_channel_access (id, workspace_id, api_key_id, stream_id, granted_by)
      VALUES (${id}, ${params.workspaceId}, ${params.apiKeyId}, ${params.streamId}, ${params.grantedBy})
      ON CONFLICT (workspace_id, api_key_id, stream_id) DO NOTHING
    `)
  },

  async revokeAccess(db: Querier, workspaceId: string, apiKeyId: string, streamId: string): Promise<void> {
    await db.query(sql`
      DELETE FROM api_key_channel_access
      WHERE workspace_id = ${workspaceId}
        AND api_key_id = ${apiKeyId}
        AND stream_id = ${streamId}
    `)
  },

  async listGrants(
    db: Querier,
    workspaceId: string,
    apiKeyId: string
  ): Promise<Array<{ streamId: string; grantedBy: string; grantedAt: Date }>> {
    const result = await db.query<{ stream_id: string; granted_by: string; granted_at: Date }>(sql`
      SELECT a.stream_id, a.granted_by, a.granted_at
      FROM api_key_channel_access a
      JOIN streams s ON s.id = a.stream_id
      WHERE a.workspace_id = ${workspaceId}
        AND a.api_key_id = ${apiKeyId}
        AND s.archived_at IS NULL
      ORDER BY a.granted_at DESC
    `)
    return result.rows.map((r) => ({ streamId: r.stream_id, grantedBy: r.granted_by, grantedAt: r.granted_at }))
  },
}
