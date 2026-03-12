import type { Querier } from "../../db"
import { sql } from "../../db"
import { Visibilities } from "@threa/types"

export const ApiKeyChannelAccessRepository = {
  async getAccessibleStreamIds(db: Querier, workspaceId: string, apiKeyId: string): Promise<string[]> {
    const result = await db.query<{ stream_id: string }>(sql`
      SELECT a.stream_id FROM api_key_channel_access a
      JOIN streams s ON s.id = a.stream_id
      WHERE a.workspace_id = ${workspaceId}
        AND a.api_key_id = ${apiKeyId}
        AND s.archived_at IS NULL
    `)
    return result.rows.map((r) => r.stream_id)
  },

  async getPublicStreamIds(db: Querier, workspaceId: string): Promise<string[]> {
    const result = await db.query<{ id: string }>(sql`
      SELECT id FROM streams
      WHERE workspace_id = ${workspaceId}
        AND visibility = ${Visibilities.PUBLIC}
        AND archived_at IS NULL
    `)
    return result.rows.map((r) => r.id)
  },
}
