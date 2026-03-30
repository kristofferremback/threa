import type { Querier } from "../../db"
import { sql } from "../../db"

interface BotRow {
  id: string
  workspace_id: string
  api_key_id: string | null
  slug: string | null
  name: string
  description: string | null
  avatar_emoji: string | null
  avatar_url: string | null
  archived_at: Date | null
  created_at: Date
  updated_at: Date
}

export interface Bot {
  id: string
  workspaceId: string
  apiKeyId: string | null
  slug: string | null
  name: string
  description: string | null
  avatarEmoji: string | null
  avatarUrl: string | null
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const BOT_COLUMNS =
  "id, workspace_id, api_key_id, slug, name, description, avatar_emoji, avatar_url, archived_at, created_at, updated_at"

function mapRowToBot(row: BotRow): Bot {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    apiKeyId: row.api_key_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    avatarEmoji: row.avatar_emoji,
    avatarUrl: row.avatar_url,
    archivedAt: row.archived_at,
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
      WHERE workspace_id = ${workspaceId} AND archived_at IS NULL
      ORDER BY created_at ASC
    `)
    return result.rows.map(mapRowToBot)
  },

  async create(
    db: Querier,
    params: {
      id: string
      workspaceId: string
      slug: string
      name: string
      description?: string | null
      avatarEmoji?: string | null
    }
  ): Promise<Bot> {
    const result = await db.query<BotRow>(sql`
      INSERT INTO bots (id, workspace_id, slug, name, description, avatar_emoji)
      VALUES (${params.id}, ${params.workspaceId}, ${params.slug}, ${params.name}, ${params.description ?? null}, ${params.avatarEmoji ?? null})
      RETURNING ${sql.raw(BOT_COLUMNS)}
    `)
    return mapRowToBot(result.rows[0])
  },

  async update(
    db: Querier,
    id: string,
    workspaceId: string,
    fields: {
      slug?: string
      name?: string
      description?: string | null
      avatarEmoji?: string | null
    }
  ): Promise<Bot | null> {
    const setClauses: string[] = []
    const values: unknown[] = []
    let paramIdx = 3 // $1 = id, $2 = workspaceId

    if (fields.slug !== undefined) {
      setClauses.push(`slug = $${paramIdx}`)
      values.push(fields.slug)
      paramIdx++
    }
    if (fields.name !== undefined) {
      setClauses.push(`name = $${paramIdx}`)
      values.push(fields.name)
      paramIdx++
    }
    if (fields.description !== undefined) {
      setClauses.push(`description = $${paramIdx}`)
      values.push(fields.description)
      paramIdx++
    }
    if (fields.avatarEmoji !== undefined) {
      setClauses.push(`avatar_emoji = $${paramIdx}`)
      values.push(fields.avatarEmoji)
      paramIdx++
    }

    if (setClauses.length === 0) {
      const result = await db.query<BotRow>(sql`
        SELECT ${sql.raw(BOT_COLUMNS)}
        FROM bots
        WHERE id = ${id} AND workspace_id = ${workspaceId} AND archived_at IS NULL
      `)
      if (!result.rows[0]) return null
      return mapRowToBot(result.rows[0])
    }

    setClauses.push("updated_at = NOW()")

    const query = `
      UPDATE bots
      SET ${setClauses.join(", ")}
      WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL
      RETURNING ${BOT_COLUMNS}
    `
    const result = await db.query<BotRow>({ text: query, values: [id, workspaceId, ...values] })
    if (!result.rows[0]) return null
    return mapRowToBot(result.rows[0])
  },

  async updateAvatarUrl(db: Querier, id: string, workspaceId: string, avatarUrl: string | null): Promise<Bot | null> {
    const result = await db.query<BotRow>(sql`
      UPDATE bots
      SET avatar_url = ${avatarUrl}, updated_at = NOW()
      WHERE id = ${id} AND workspace_id = ${workspaceId}
      RETURNING ${sql.raw(BOT_COLUMNS)}
    `)
    if (!result.rows[0]) return null
    return mapRowToBot(result.rows[0])
  },

  async archive(db: Querier, id: string, workspaceId: string): Promise<Bot | null> {
    const result = await db.query<BotRow>(sql`
      UPDATE bots
      SET archived_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND workspace_id = ${workspaceId} AND archived_at IS NULL
      RETURNING ${sql.raw(BOT_COLUMNS)}
    `)
    if (!result.rows[0]) return null
    return mapRowToBot(result.rows[0])
  },

  async restore(db: Querier, id: string, workspaceId: string): Promise<Bot | null> {
    const result = await db.query<BotRow>(sql`
      UPDATE bots
      SET archived_at = NULL, updated_at = NOW()
      WHERE id = ${id} AND workspace_id = ${workspaceId} AND archived_at IS NOT NULL
      RETURNING ${sql.raw(BOT_COLUMNS)}
    `)
    if (!result.rows[0]) return null
    return mapRowToBot(result.rows[0])
  },

  /**
   * Legacy upsert for WorkOS API keys (migration period).
   * On conflict, does NOT override name/profile — preserves admin customizations.
   */
  async findOrCreate(
    db: Querier,
    params: { id: string; workspaceId: string; apiKeyId: string; name: string }
  ): Promise<{ bot: Bot; isInsert: boolean }> {
    const result = await db.query<BotRow & { is_insert: boolean }>(sql`
      INSERT INTO bots (id, workspace_id, api_key_id, name)
      VALUES (${params.id}, ${params.workspaceId}, ${params.apiKeyId}, ${params.name})
      ON CONFLICT (workspace_id, api_key_id)
      DO UPDATE SET updated_at = NOW()
      RETURNING ${sql.raw(BOT_COLUMNS)}, (xmax = 0) AS is_insert
    `)
    const row = result.rows[0]
    return {
      bot: mapRowToBot(row),
      isInsert: row.is_insert,
    }
  },
}
