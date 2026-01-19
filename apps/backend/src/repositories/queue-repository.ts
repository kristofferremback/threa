import type { Querier } from "../db"
import { sql } from "../db"

// Internal row type (snake_case)
interface QueueMessageRow {
  id: string
  queue_name: string
  workspace_id: string
  payload: unknown
  process_after: Date
  inserted_at: Date
  claimed_at: Date | null
  claimed_by: string | null
  claimed_until: Date | null
  claimed_count: number
  failed_count: number
  last_error: string | null
  dlq_at: Date | null
  completed_at: Date | null
}

// Domain type (camelCase)
export interface QueueMessage {
  id: string
  queueName: string
  workspaceId: string
  payload: unknown
  processAfter: Date
  insertedAt: Date
  claimedAt: Date | null
  claimedBy: string | null
  claimedUntil: Date | null
  claimedCount: number
  failedCount: number
  lastError: string | null
  dlqAt: Date | null
  completedAt: Date | null
}

// Insert params
export interface InsertQueueMessageParams {
  id: string
  queueName: string
  workspaceId: string
  payload: unknown
  processAfter: Date
  insertedAt: Date
}

// Claim params
export interface ClaimNextParams {
  queueName: string
  workspaceId: string
  claimedBy: string
  claimedAt: Date
  claimedUntil: Date
  now: Date
}

// Batch renew claims params
export interface BatchRenewClaimsParams {
  messageIds: string[]
  claimedBy: string
  claimedUntil: Date
}

// Complete params
export interface CompleteParams {
  messageId: string
  claimedBy: string
  completedAt: Date
}

// Fail params (retry with backoff)
export interface FailParams {
  messageId: string
  claimedBy: string
  error: string
  processAfter: Date
  now: Date
}

// Fail to DLQ params
export interface FailDlqParams {
  messageId: string
  claimedBy: string
  error: string
  dlqAt: Date
}

// UnDlq params
export interface UnDlqParams {
  messageId: string
  processAfter: Date
}

// Delete old messages params
export interface DeleteOldMessagesParams {
  completedBeforeDate: Date
  dlqBeforeDate: Date
}

// Mapper
function mapRowToMessage(row: QueueMessageRow): QueueMessage {
  return {
    id: row.id,
    queueName: row.queue_name,
    workspaceId: row.workspace_id,
    payload: row.payload,
    processAfter: row.process_after,
    insertedAt: row.inserted_at,
    claimedAt: row.claimed_at,
    claimedBy: row.claimed_by,
    claimedUntil: row.claimed_until,
    claimedCount: row.claimed_count,
    failedCount: row.failed_count,
    lastError: row.last_error,
    dlqAt: row.dlq_at,
    completedAt: row.completed_at,
  }
}

const SELECT_FIELDS = sql.raw(`
  id, queue_name, workspace_id, payload,
  process_after, inserted_at,
  claimed_at, claimed_by, claimed_until, claimed_count,
  failed_count, last_error,
  dlq_at, completed_at
`)

export const QueueRepository = {
  /**
   * Insert a new message.
   */
  async insert(db: Querier, params: InsertQueueMessageParams): Promise<QueueMessage> {
    const result = await db.query<QueueMessageRow>(
      sql`
        INSERT INTO queue_messages (
          id, queue_name, workspace_id, payload,
          process_after, inserted_at
        ) VALUES (
          ${params.id},
          ${params.queueName},
          ${params.workspaceId},
          ${JSON.stringify(params.payload)},
          ${params.processAfter},
          ${params.insertedAt}
        )
        RETURNING ${SELECT_FIELDS}
      `
    )
    return mapRowToMessage(result.rows[0])
  },

  /**
   * Batch insert multiple messages.
   * More efficient than calling insert() multiple times.
   */
  async batchInsert(db: Querier, messages: InsertQueueMessageParams[]): Promise<QueueMessage[]> {
    if (messages.length === 0) {
      return []
    }

    // Build placeholders and values array for batch insert
    const placeholders: string[] = []
    const values: unknown[] = []
    let idx = 1

    for (const msg of messages) {
      placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}::jsonb, $${idx++}, $${idx++})`)
      values.push(msg.id, msg.queueName, msg.workspaceId, JSON.stringify(msg.payload), msg.processAfter, msg.insertedAt)
    }

    const result = await db.query<QueueMessageRow>(
      `INSERT INTO queue_messages (
        id, queue_name, workspace_id, payload,
        process_after, inserted_at
      ) VALUES ${placeholders.join(", ")}
      RETURNING
        id, queue_name, workspace_id, payload,
        process_after, inserted_at,
        claimed_at, claimed_by, claimed_until, claimed_count,
        failed_count, last_error,
        dlq_at, completed_at`,
      values
    )

    return result.rows.map(mapRowToMessage)
  },

  /**
   * Batch claim multiple messages for (queue, workspace) pair.
   * Returns array of claimed messages (may be fewer than limit if not enough available).
   *
   * CRITICAL: Uses FOR UPDATE SKIP LOCKED for concurrency.
   * Only one worker can claim the same message.
   */
  async batchClaimMessages(db: Querier, params: ClaimNextParams & { limit: number }): Promise<QueueMessage[]> {
    const result = await db.query<QueueMessageRow>(
      sql`
        WITH selected AS (
          SELECT id
          FROM queue_messages
          WHERE queue_name = ${params.queueName}
            AND workspace_id = ${params.workspaceId}
            AND process_after <= ${params.now}
            AND (claimed_until IS NULL OR claimed_until < ${params.now})
          ORDER BY process_after ASC
          LIMIT ${params.limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE queue_messages
        SET
          claimed_at = ${params.claimedAt},
          claimed_by = ${params.claimedBy},
          claimed_until = ${params.claimedUntil},
          claimed_count = claimed_count + 1
        FROM selected
        WHERE queue_messages.id = selected.id
        RETURNING
          queue_messages.id,
          queue_messages.queue_name,
          queue_messages.workspace_id,
          queue_messages.payload,
          queue_messages.process_after,
          queue_messages.inserted_at,
          queue_messages.claimed_at,
          queue_messages.claimed_by,
          queue_messages.claimed_until,
          queue_messages.claimed_count,
          queue_messages.failed_count,
          queue_messages.last_error,
          queue_messages.dlq_at,
          queue_messages.completed_at
      `
    )

    // Sort by process_after for consistent ordering (though parallel processing means completion order varies)
    const messages = result.rows.map(mapRowToMessage)
    messages.sort((a, b) => a.processAfter.getTime() - b.processAfter.getTime())

    return messages
  },

  /**
   * Batch renew claims for multiple messages.
   * Returns count of successfully renewed claims.
   *
   * Messages that have been completed or moved to DLQ will not be renewed.
   * This supports partial success - some messages may complete while others are still processing.
   */
  async batchRenewClaims(db: Querier, params: BatchRenewClaimsParams): Promise<number> {
    const result = await db.query(
      sql`
        UPDATE queue_messages
        SET claimed_until = ${params.claimedUntil}
        WHERE id = ANY(${params.messageIds})
          AND claimed_by = ${params.claimedBy}
          AND completed_at IS NULL
          AND dlq_at IS NULL
      `
    )

    return result.rowCount ?? 0
  },

  /**
   * Mark message as completed.
   * Verifies claimedBy to prevent race conditions.
   */
  async complete(db: Querier, params: CompleteParams): Promise<void> {
    const result = await db.query(
      sql`
        UPDATE queue_messages
        SET
          completed_at = ${params.completedAt},
          process_after = NULL,
          claimed_by = NULL,
          claimed_until = NULL
        WHERE id = ${params.messageId}
          AND claimed_by = ${params.claimedBy}
          AND completed_at IS NULL
      `
    )

    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`Failed to complete message ${params.messageId}: not found or wrong claimedBy`)
    }
  },

  /**
   * Record failure and set retry backoff.
   * Increments failed_count, sets process_after for retry.
   * Does NOT move to DLQ.
   *
   * Verifies claimedBy to prevent race conditions.
   */
  async fail(db: Querier, params: FailParams): Promise<void> {
    const result = await db.query(
      sql`
        UPDATE queue_messages
        SET
          failed_count = failed_count + 1,
          last_error = ${params.error},
          process_after = ${params.processAfter},
          claimed_by = NULL,
          claimed_until = NULL
        WHERE id = ${params.messageId}
          AND claimed_by = ${params.claimedBy}
          AND completed_at IS NULL
          AND dlq_at IS NULL
      `
    )

    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`Failed to record failure for message ${params.messageId}: not found or wrong claimedBy`)
    }
  },

  /**
   * Move message to DLQ.
   * Sets dlq_at, releases claim.
   *
   * Verifies claimedBy to prevent race conditions.
   */
  async failDlq(db: Querier, params: FailDlqParams): Promise<void> {
    const result = await db.query(
      sql`
        UPDATE queue_messages
        SET
          dlq_at = ${params.dlqAt},
          last_error = ${params.error},
          process_after = NULL,
          claimed_by = NULL,
          claimed_until = NULL
        WHERE id = ${params.messageId}
          AND claimed_by = ${params.claimedBy}
          AND completed_at IS NULL
          AND dlq_at IS NULL
      `
    )

    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`Failed to move message ${params.messageId} to DLQ: not found or wrong claimedBy`)
    }
  },

  /**
   * Un-DLQ a message.
   * Clears dlq_at, resets failed_count, sets process_after for immediate retry.
   */
  async unDlq(db: Querier, params: UnDlqParams): Promise<void> {
    const result = await db.query(
      sql`
        UPDATE queue_messages
        SET
          dlq_at = NULL,
          failed_count = 0,
          last_error = NULL,
          process_after = ${params.processAfter}
        WHERE id = ${params.messageId}
          AND dlq_at IS NOT NULL
      `
    )

    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`Failed to un-DLQ message ${params.messageId}: not found or not in DLQ`)
    }
  },

  /**
   * Delete old messages for retention.
   * - Completed messages older than completedBeforeDate
   * - DLQ messages older than dlqBeforeDate
   */
  async deleteOldMessages(
    db: Querier,
    params: DeleteOldMessagesParams
  ): Promise<{ completedDeleted: number; dlqDeleted: number }> {
    const completedResult = await db.query(
      sql`
        DELETE FROM queue_messages
        WHERE completed_at IS NOT NULL
          AND completed_at < ${params.completedBeforeDate}
      `
    )

    const dlqResult = await db.query(
      sql`
        DELETE FROM queue_messages
        WHERE dlq_at IS NOT NULL
          AND dlq_at < ${params.dlqBeforeDate}
      `
    )

    return {
      completedDeleted: completedResult.rowCount ?? 0,
      dlqDeleted: dlqResult.rowCount ?? 0,
    }
  },

  /**
   * Get message by ID (for testing/debugging)
   */
  async getById(db: Querier, id: string): Promise<QueueMessage | null> {
    const result = await db.query<QueueMessageRow>(
      sql`
        SELECT ${SELECT_FIELDS}
        FROM queue_messages
        WHERE id = ${id}
      `
    )

    return result.rows[0] ? mapRowToMessage(result.rows[0]) : null
  },
}
