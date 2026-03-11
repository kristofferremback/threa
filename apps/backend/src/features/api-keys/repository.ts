import type { Querier } from "../../db"
import { sql } from "../../db"

export const ApiKeyChannelAccessRepository = {
  async getAccessibleStreamIds(db: Querier, workspaceId: string, apiKeyId: string): Promise<string[]> {
    const result = await db.query<{ stream_id: string }>(sql`
      SELECT stream_id FROM api_key_channel_access
      WHERE workspace_id = ${workspaceId} AND api_key_id = ${apiKeyId}
    `)
    return result.rows.map((r) => r.stream_id)
  },
}
