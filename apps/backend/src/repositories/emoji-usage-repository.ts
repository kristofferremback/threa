import { sql, type Querier } from "../db"

type InteractionType = "message" | "message_reaction"

interface EmojiUsageRow {
  id: string
  workspace_id: string
  member_id: string
  interaction_type: string
  shortcode: string
  occurrence_count: number
  source_id: string
  created_at: Date
}

export interface EmojiUsage {
  id: string
  workspaceId: string
  memberId: string
  interactionType: InteractionType
  shortcode: string
  occurrenceCount: number
  sourceId: string
  createdAt: Date
}

export interface InsertEmojiUsageParams {
  id: string
  workspaceId: string
  memberId: string
  interactionType: InteractionType
  shortcode: string
  occurrenceCount: number
  sourceId: string
}

function mapRowToEmojiUsage(row: EmojiUsageRow): EmojiUsage {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    memberId: row.member_id,
    interactionType: row.interaction_type as InteractionType,
    shortcode: row.shortcode,
    occurrenceCount: row.occurrence_count,
    sourceId: row.source_id,
    createdAt: row.created_at,
  }
}

const SELECT_FIELDS = `id, workspace_id, member_id, interaction_type, shortcode, occurrence_count, source_id, created_at`

export const EmojiUsageRepository = {
  async insertBatch(db: Querier, items: InsertEmojiUsageParams[]): Promise<EmojiUsage[]> {
    if (items.length === 0) return []

    const result = await db.query<EmojiUsageRow>(sql`
      INSERT INTO emoji_usage (id, workspace_id, member_id, interaction_type, shortcode, occurrence_count, source_id)
      SELECT * FROM UNNEST(
        ${items.map((i) => i.id)}::text[],
        ${items.map((i) => i.workspaceId)}::text[],
        ${items.map((i) => i.memberId)}::text[],
        ${items.map((i) => i.interactionType)}::text[],
        ${items.map((i) => i.shortcode)}::text[],
        ${items.map((i) => i.occurrenceCount)}::int[],
        ${items.map((i) => i.sourceId)}::text[]
      )
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return result.rows.map(mapRowToEmojiUsage)
  },

  async insert(db: Querier, params: InsertEmojiUsageParams): Promise<EmojiUsage> {
    const result = await db.query<EmojiUsageRow>(sql`
      INSERT INTO emoji_usage (id, workspace_id, member_id, interaction_type, shortcode, occurrence_count, source_id)
      VALUES (${params.id}, ${params.workspaceId}, ${params.memberId}, ${params.interactionType}, ${params.shortcode}, ${params.occurrenceCount}, ${params.sourceId})
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return mapRowToEmojiUsage(result.rows[0])
  },

  async getWeights(db: Querier, workspaceId: string, memberId: string): Promise<Record<string, number>> {
    const result = await db.query<{ shortcode: string; weight: string }>(sql`
      WITH recent_usage AS (
        SELECT
          shortcode,
          occurrence_count,
          ROW_NUMBER() OVER (PARTITION BY interaction_type ORDER BY created_at DESC) as rn
        FROM emoji_usage
        WHERE workspace_id = ${workspaceId} AND member_id = ${memberId}
      )
      SELECT shortcode, SUM(occurrence_count)::text as weight
      FROM recent_usage
      WHERE rn <= 100
      GROUP BY shortcode
      ORDER BY weight DESC
    `)

    const weights: Record<string, number> = {}
    for (const row of result.rows) {
      weights[row.shortcode] = parseInt(row.weight, 10)
    }
    return weights
  },
}
