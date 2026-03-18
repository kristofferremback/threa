import type { Querier } from "../../db"
import { sql } from "../../db"

interface BotRow {
  id: string
  workspace_id: string
  api_key_id: string
  name: string
  description: string | null
  avatar_emoji: string | null
  created_at: Date
  updated_at: Date
}

export interface Bot {
  id: string
  workspaceId: string
  apiKeyId: string
  name: string
  description: string | null
  avatarEmoji: string | null
  createdAt: Date
  updatedAt: Date
}

const BOT_COLUMNS = "id, workspace_id, api_key_id, name, description, avatar_emoji, created_at, updated_at"

function mapRowToBot(row: BotRow): Bot {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    apiKeyId: row.api_key_id,
    name: row.name,
    description: row.description,
    avatarEmoji: row.avatar_emoji,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const BotRepository = {
  async findByApiKeyId(db: Querier, workspaceId: string, apiKeyId: string): Promise<Bot | null> {
    const result = await db.query<BotRow>(sql`
      SELECT ${sql.raw(BOT_COLUMNS)}
      FROM bots
      WHERE workspace_id = ${workspaceId} AND api_key_id = ${apiKeyId}
    `)
    if (!result.rows[0]) return null
    return mapRowToBot(result.rows[0])
  },

  async findById(db: Querier, id: string): Promise<Bot | null> {
    const result = await db.query<BotRow>(sql`
      SELECT ${sql.raw(BOT_COLUMNS)}
      FROM bots
      WHERE id = ${id}
    `)
    if (!result.rows[0]) return null
    return mapRowToBot(result.rows[0])
  },

  async findByIds(db: Querier, ids: string[]): Promise<Bot[]> {
    if (ids.length === 0) return []
    const result = await db.query<BotRow>(sql`
      SELECT ${sql.raw(BOT_COLUMNS)}
      FROM bots
      WHERE id = ANY(${ids})
    `)
    return result.rows.map(mapRowToBot)
  },

  async listByWorkspace(db: Querier, workspaceId: string): Promise<Bot[]> {
    const result = await db.query<BotRow>(sql`
      SELECT ${sql.raw(BOT_COLUMNS)}
      FROM bots
      WHERE workspace_id = ${workspaceId}
      ORDER BY created_at ASC
    `)
    return result.rows.map(mapRowToBot)
  },

  async upsert(
    db: Querier,
    params: { id: string; workspaceId: string; apiKeyId: string; name: string }
  ): Promise<{ bot: Bot; isInsert: boolean }> {
    const result = await db.query<BotRow & { is_insert: boolean }>(sql`
      INSERT INTO bots (id, workspace_id, api_key_id, name)
      VALUES (${params.id}, ${params.workspaceId}, ${params.apiKeyId}, ${params.name})
      ON CONFLICT (workspace_id, api_key_id)
      DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
      RETURNING ${sql.raw(BOT_COLUMNS)}, (xmax = 0) AS is_insert
    `)
    const row = result.rows[0]
    return { bot: mapRowToBot(row), isInsert: row.is_insert }
  },
}
