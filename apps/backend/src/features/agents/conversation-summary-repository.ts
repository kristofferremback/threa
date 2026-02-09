import type { Querier } from "../../db"
import { sql } from "../../db"

interface ConversationSummaryRow {
  id: string
  workspace_id: string
  stream_id: string
  persona_id: string
  summary: string
  last_summarized_sequence: string
  created_at: Date
  updated_at: Date
}

export interface AgentConversationSummary {
  id: string
  workspaceId: string
  streamId: string
  personaId: string
  summary: string
  lastSummarizedSequence: bigint
  createdAt: Date
  updatedAt: Date
}

export interface UpsertConversationSummaryParams {
  id: string
  workspaceId: string
  streamId: string
  personaId: string
  summary: string
  lastSummarizedSequence: bigint
}

function mapRowToSummary(row: ConversationSummaryRow): AgentConversationSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    streamId: row.stream_id,
    personaId: row.persona_id,
    summary: row.summary,
    lastSummarizedSequence: BigInt(row.last_summarized_sequence),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const SELECT_FIELDS = `
  id, workspace_id, stream_id, persona_id, summary, last_summarized_sequence,
  created_at, updated_at
`

export const ConversationSummaryRepository = {
  async findByStreamAndPersona(
    db: Querier,
    streamId: string,
    personaId: string
  ): Promise<AgentConversationSummary | null> {
    const result = await db.query<ConversationSummaryRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)}
      FROM agent_conversation_summaries
      WHERE stream_id = ${streamId}
        AND persona_id = ${personaId}
      LIMIT 1
    `)
    return result.rows[0] ? mapRowToSummary(result.rows[0]) : null
  },

  async upsert(db: Querier, params: UpsertConversationSummaryParams): Promise<AgentConversationSummary> {
    const result = await db.query<ConversationSummaryRow>(sql`
      INSERT INTO agent_conversation_summaries (
        id, workspace_id, stream_id, persona_id, summary, last_summarized_sequence
      ) VALUES (
        ${params.id},
        ${params.workspaceId},
        ${params.streamId},
        ${params.personaId},
        ${params.summary},
        ${params.lastSummarizedSequence.toString()}
      )
      ON CONFLICT (stream_id, persona_id) DO UPDATE SET
        summary = EXCLUDED.summary,
        last_summarized_sequence = EXCLUDED.last_summarized_sequence,
        updated_at = NOW()
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return mapRowToSummary(result.rows[0])
  },
}
