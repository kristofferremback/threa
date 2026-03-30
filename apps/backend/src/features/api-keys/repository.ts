import type { Querier } from "../../db"
import { sql } from "../../db"

export const BotChannelAccessRepository = {
  async getGrantedStreamIds(db: Querier, workspaceId: string, botId: string): Promise<string[]> {
    const result = await db.query<{ stream_id: string }>(sql`
      SELECT a.stream_id FROM bot_channel_access a
      JOIN streams s ON s.id = a.stream_id
      WHERE a.workspace_id = ${workspaceId}
        AND a.bot_id = ${botId}
        AND s.archived_at IS NULL
    `)
    return result.rows.map((r) => r.stream_id)
  },

  async grantAccess(
    db: Querier,
    params: { id: string; workspaceId: string; botId: string; streamId: string; grantedBy: string }
  ): Promise<void> {
    await db.query(sql`
      INSERT INTO bot_channel_access (id, workspace_id, bot_id, stream_id, granted_by)
      VALUES (${params.id}, ${params.workspaceId}, ${params.botId}, ${params.streamId}, ${params.grantedBy})
      ON CONFLICT (workspace_id, bot_id, stream_id) DO NOTHING
    `)
  },

  async revokeAccess(db: Querier, workspaceId: string, botId: string, streamId: string): Promise<void> {
    await db.query(sql`
      DELETE FROM bot_channel_access
      WHERE workspace_id = ${workspaceId}
        AND bot_id = ${botId}
        AND stream_id = ${streamId}
    `)
  },

  async revokeAllByBot(db: Querier, workspaceId: string, botId: string): Promise<void> {
    await db.query(sql`
      DELETE FROM bot_channel_access
      WHERE workspace_id = ${workspaceId}
        AND bot_id = ${botId}
    `)
  },

  async getGrantedBotIds(db: Querier, workspaceId: string, streamId: string): Promise<string[]> {
    const result = await db.query<{ bot_id: string }>(sql`
      SELECT a.bot_id FROM bot_channel_access a
      JOIN bots b ON b.id = a.bot_id
      WHERE a.workspace_id = ${workspaceId}
        AND a.stream_id = ${streamId}
        AND b.archived_at IS NULL
    `)
    return result.rows.map((r) => r.bot_id)
  },

  async listGrants(
    db: Querier,
    workspaceId: string,
    botId: string
  ): Promise<Array<{ streamId: string; grantedBy: string; grantedAt: Date }>> {
    const result = await db.query<{ stream_id: string; granted_by: string; granted_at: Date }>(sql`
      SELECT a.stream_id, a.granted_by, a.granted_at
      FROM bot_channel_access a
      JOIN streams s ON s.id = a.stream_id
      WHERE a.workspace_id = ${workspaceId}
        AND a.bot_id = ${botId}
        AND s.archived_at IS NULL
      ORDER BY a.granted_at DESC
    `)
    return result.rows.map((r) => ({ streamId: r.stream_id, grantedBy: r.granted_by, grantedAt: r.granted_at }))
  },
}
