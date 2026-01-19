import type { Querier } from "../db"
import { sql } from "../db"
import { tokenId } from "../lib/id"

// Internal row type (snake_case)
interface QueueTokenRow {
  id: string
  queue_name: string
  workspace_id: string
  leased_at: Date
  leased_by: string
  leased_until: Date
  next_process_after: Date
  created_at: Date
}

// Domain type (camelCase)
export interface QueueToken {
  id: string
  queueName: string
  workspaceId: string
  leasedAt: Date
  leasedBy: string
  leasedUntil: Date
  nextProcessAfter: Date
  createdAt: Date
}

// Batch lease params
export interface BatchLeaseTokensParams {
  leasedBy: string
  leasedAt: Date
  leasedUntil: Date
  now: Date
  limit: number
  queueNames: string[] // Only lease tokens for these queues
}

// Renew lease params
export interface RenewLeaseParams {
  tokenId: string
  leasedBy: string
  leasedUntil: Date
}

// Delete token params
export interface DeleteTokenParams {
  tokenId: string
  leasedBy: string
}

// Delete expired params
export interface DeleteExpiredTokensParams {
  now: Date
}

// Mapper
function mapRowToToken(row: QueueTokenRow): QueueToken {
  return {
    id: row.id,
    queueName: row.queue_name,
    workspaceId: row.workspace_id,
    leasedAt: row.leased_at,
    leasedBy: row.leased_by,
    leasedUntil: row.leased_until,
    nextProcessAfter: row.next_process_after,
    createdAt: row.created_at,
  }
}

const SELECT_FIELDS = sql.raw(`
  id, queue_name, workspace_id,
  leased_at, leased_by, leased_until,
  next_process_after, created_at
`)

export const TokenPoolRepository = {
  /**
   * Atomically lease a batch of tokens.
   *
   * Algorithm:
   * 1. Find available (queue, workspace) pairs with pending messages
   * 2. Exclude pairs that already have active tokens
   * 3. Order by earliest process_after (fairness)
   * 4. INSERT tokens for selected pairs
   * 5. RETURN leased tokens
   *
   * Returns empty array if no work available.
   *
   * TODO: Implement chunking based on scalingThreshold - split pairs with high
   * pending_count into multiple tokens.
   */
  async batchLeaseTokens(db: Querier, params: BatchLeaseTokensParams): Promise<QueueToken[]> {
    // Pre-generate ULIDs (INV-2: all entity IDs must be prefix_ulid)
    // Generate limit ULIDs upfront, actual usage will be limited by available pairs
    const tokenIds = Array.from({ length: params.limit }, () => tokenId())

    const result = await db.query<QueueTokenRow>(
      sql`
        WITH available_pairs AS (
          SELECT
            queue_name,
            workspace_id,
            MIN(process_after) AS next_process_after,
            COUNT(*) AS pending_count
          FROM queue_messages
          WHERE process_after <= ${params.now}
            AND dlq_at IS NULL
            AND completed_at IS NULL
            AND (claimed_until IS NULL OR claimed_until < ${params.now})
            AND queue_name = ANY(${params.queueNames})
          GROUP BY queue_name, workspace_id
        ),
        pairs_without_tokens AS (
          -- Exclude pairs that already have active tokens
          -- Use LEFT JOIN instead of NOT EXISTS for better performance
          SELECT
            ap.queue_name,
            ap.workspace_id,
            ap.next_process_after,
            ap.pending_count
          FROM available_pairs ap
          LEFT JOIN queue_tokens qt ON
            qt.queue_name = ap.queue_name
            AND qt.workspace_id = ap.workspace_id
            AND qt.leased_until > ${params.now}
          WHERE qt.id IS NULL
        ),
        selected_pairs AS (
          SELECT
            queue_name,
            workspace_id,
            next_process_after,
            pending_count,
            ROW_NUMBER() OVER (ORDER BY next_process_after ASC) AS rn
          FROM pairs_without_tokens
          ORDER BY next_process_after ASC
          LIMIT ${params.limit}
        ),
        token_ids AS (
          SELECT
            id,
            ROW_NUMBER() OVER () AS rn
          FROM unnest(${tokenIds}::text[]) AS id
        )
        INSERT INTO queue_tokens (
          id, queue_name, workspace_id,
          leased_at, leased_by, leased_until,
          next_process_after, created_at
        )
        SELECT
          t.id,
          sp.queue_name,
          sp.workspace_id,
          ${params.leasedAt},
          ${params.leasedBy},
          ${params.leasedUntil},
          sp.next_process_after,
          ${params.leasedAt}
        FROM selected_pairs sp
        JOIN token_ids t ON t.rn = sp.rn
        RETURNING ${SELECT_FIELDS}
      `
    )

    return result.rows.map(mapRowToToken)
  },

  /**
   * Renew lease for a token.
   * Returns false if lease lost.
   *
   * Verifies leasedBy to prevent race conditions.
   */
  async renewLease(db: Querier, params: RenewLeaseParams): Promise<boolean> {
    const result = await db.query(
      sql`
        UPDATE queue_tokens
        SET leased_until = ${params.leasedUntil}
        WHERE id = ${params.tokenId}
          AND leased_by = ${params.leasedBy}
      `
    )

    return (result.rowCount ?? 0) > 0
  },

  /**
   * Delete a token (release work unit).
   *
   * Verifies leasedBy to prevent race conditions.
   */
  async deleteToken(db: Querier, params: DeleteTokenParams): Promise<void> {
    const result = await db.query(
      sql`
        DELETE FROM queue_tokens
        WHERE id = ${params.tokenId}
          AND leased_by = ${params.leasedBy}
      `
    )

    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`Failed to delete token ${params.tokenId}: not found or wrong leasedBy`)
    }
  },

  /**
   * Delete expired tokens (cleanup).
   * Returns count of deleted tokens.
   */
  async deleteExpiredTokens(db: Querier, params: DeleteExpiredTokensParams): Promise<number> {
    const result = await db.query(
      sql`
        DELETE FROM queue_tokens
        WHERE leased_until < ${params.now}
      `
    )

    return result.rowCount ?? 0
  },

  /**
   * Get token by ID (for testing/debugging)
   */
  async getById(db: Querier, id: string): Promise<QueueToken | null> {
    const result = await db.query<QueueTokenRow>(
      sql`
        SELECT ${SELECT_FIELDS}
        FROM queue_tokens
        WHERE id = ${id}
      `
    )

    return result.rows[0] ? mapRowToToken(result.rows[0]) : null
  },
}
