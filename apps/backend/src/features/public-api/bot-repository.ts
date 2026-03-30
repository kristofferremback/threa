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
    if (
      fields.slug === undefined &&
      fields.name === undefined &&
      fields.description === undefined &&
      fields.avatarEmoji === undefined
    ) {
      const result = await db.query<BotRow>(sql`
        SELECT ${sql.raw(BOT_COLUMNS)}
        FROM bots
        WHERE id = ${id} AND workspace_id = ${workspaceId} AND archived_at IS NULL
      `)
      if (!result.rows[0]) return null
      return mapRowToBot(result.rows[0])
    }

    // Dynamic SET with parameterized values. Column names are hardcoded constants;
    // only user-provided values go through parameter binding ($N).
    const setParts: string[] = []
    const values: unknown[] = []
    let idx = 1
    if (fields.slug !== undefined) {
      setParts.push(`slug = $${idx++}`)
      values.push(fields.slug)
    }
    if (fields.name !== undefined) {
      setParts.push(`name = $${idx++}`)
      values.push(fields.name)
    }
    if (fields.description !== undefined) {
      setParts.push(`description = $${idx++}`)
      values.push(fields.description)
    }
    if (fields.avatarEmoji !== undefined) {
      setParts.push(`avatar_emoji = $${idx++}`)
      values.push(fields.avatarEmoji)
    }
    setParts.push("updated_at = NOW()")
    const idIdx = idx++
    const wsIdx = idx
    values.push(id, workspaceId)

    const result = await db.query<BotRow>({
      text: `UPDATE bots SET ${setParts.join(", ")} WHERE id = $${idIdx} AND workspace_id = $${wsIdx} AND archived_at IS NULL RETURNING ${BOT_COLUMNS}`,
      values,
    })
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
}
