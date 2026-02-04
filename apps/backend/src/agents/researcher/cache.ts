import { sql, type Querier } from "../../db"
import { researcherCacheId } from "../../lib/id"
import type { AgentAccessSpec } from "./access-spec"

/**
 * Cached result from the researcher.
 */
export interface ResearcherCacheEntry {
  id: string
  workspaceId: string
  messageId: string
  streamId: string
  accessSpec: AgentAccessSpec
  result: ResearcherCachedResult
  createdAt: Date
  expiresAt: Date
}

/**
 * The cached research result stored in JSONB.
 */
export interface ResearcherCachedResult {
  shouldSearch: boolean
  retrievedContext: string | null
  sources: Array<{
    type: "web" | "workspace"
    title: string
    url: string
    snippet?: string
  }>
  searchesPerformed: Array<{
    target: "memos" | "messages" | "attachments"
    type: "semantic" | "exact"
    query: string
    resultCount: number
  }>
}

interface CacheRow {
  id: string
  workspace_id: string
  message_id: string
  stream_id: string
  access_spec: AgentAccessSpec
  result: ResearcherCachedResult
  created_at: Date
  expires_at: Date
}

function mapRowToEntry(row: CacheRow): ResearcherCacheEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    messageId: row.message_id,
    streamId: row.stream_id,
    accessSpec: row.access_spec,
    result: row.result,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }
}

// Default TTL: 1 hour
const DEFAULT_TTL_MS = 60 * 60 * 1000

export const ResearcherCache = {
  /**
   * Find cached research result for a message.
   * Returns null if no cache entry exists or if expired.
   */
  async findByMessage(db: Querier, messageId: string): Promise<ResearcherCacheEntry | null> {
    const result = await db.query<CacheRow>(sql`
      SELECT id, workspace_id, message_id, stream_id, access_spec, result, created_at, expires_at
      FROM researcher_cache
      WHERE message_id = ${messageId}
        AND expires_at > NOW()
    `)

    if (!result.rows[0]) return null
    return mapRowToEntry(result.rows[0])
  },

  /**
   * Store a research result in the cache.
   * Uses INSERT ON CONFLICT to handle concurrent inserts for the same message.
   */
  async set(
    db: Querier,
    params: {
      workspaceId: string
      messageId: string
      streamId: string
      accessSpec: AgentAccessSpec
      result: ResearcherCachedResult
      ttlMs?: number
    }
  ): Promise<ResearcherCacheEntry> {
    const { workspaceId, messageId, streamId, accessSpec, result, ttlMs = DEFAULT_TTL_MS } = params

    const id = researcherCacheId()
    const expiresAt = new Date(Date.now() + ttlMs)

    const queryResult = await db.query<CacheRow>(sql`
      INSERT INTO researcher_cache (id, workspace_id, message_id, stream_id, access_spec, result, expires_at)
      VALUES (
        ${id},
        ${workspaceId},
        ${messageId},
        ${streamId},
        ${JSON.stringify(accessSpec)}::jsonb,
        ${JSON.stringify(result)}::jsonb,
        ${expiresAt}
      )
      ON CONFLICT (message_id) DO UPDATE SET
        access_spec = EXCLUDED.access_spec,
        result = EXCLUDED.result,
        expires_at = EXCLUDED.expires_at
      RETURNING id, workspace_id, message_id, stream_id, access_spec, result, created_at, expires_at
    `)

    return mapRowToEntry(queryResult.rows[0])
  },

  /**
   * Delete expired cache entries.
   * Call periodically to keep the table clean.
   */
  async deleteExpired(db: Querier): Promise<number> {
    const result = await db.query(sql`
      DELETE FROM researcher_cache
      WHERE expires_at < NOW()
    `)
    return result.rowCount ?? 0
  },

  /**
   * Invalidate cache for a specific message.
   * Use when the message content changes.
   */
  async invalidate(db: Querier, messageId: string): Promise<boolean> {
    const result = await db.query(sql`
      DELETE FROM researcher_cache
      WHERE message_id = ${messageId}
    `)
    return (result.rowCount ?? 0) > 0
  },

  /**
   * Invalidate all cache entries for a workspace.
   * Use when workspace settings change.
   */
  async invalidateWorkspace(db: Querier, workspaceId: string): Promise<number> {
    const result = await db.query(sql`
      DELETE FROM researcher_cache
      WHERE workspace_id = ${workspaceId}
    `)
    return result.rowCount ?? 0
  },
}
