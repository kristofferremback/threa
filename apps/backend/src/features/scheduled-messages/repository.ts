import type { Querier } from "../../db"
import { sql } from "../../db"
import { ScheduledMessageStatuses, type ScheduledMessageStatus, type JSONContent } from "@threa/types"

interface ScheduledMessageRow {
  id: string
  workspace_id: string
  user_id: string
  stream_id: string
  parent_message_id: string | null
  content_json: JSONContent
  content_markdown: string
  attachment_ids: string[]
  metadata: Record<string, string> | null
  scheduled_for: Date
  status: string
  sent_message_id: string | null
  last_error: string | null
  queue_message_id: string | null
  edit_lock_owner_id: string | null
  edit_lock_expires_at: Date | null
  client_message_id: string | null
  retry_count: number
  created_at: Date
  updated_at: Date
  status_changed_at: Date
}

export interface ScheduledMessage {
  id: string
  workspaceId: string
  userId: string
  streamId: string
  parentMessageId: string | null
  contentJson: JSONContent
  contentMarkdown: string
  attachmentIds: string[]
  metadata: Record<string, string> | null
  scheduledFor: Date
  status: ScheduledMessageStatus
  sentMessageId: string | null
  lastError: string | null
  queueMessageId: string | null
  editLockOwnerId: string | null
  editLockExpiresAt: Date | null
  clientMessageId: string | null
  retryCount: number
  createdAt: Date
  updatedAt: Date
  statusChangedAt: Date
}

export interface InsertScheduledMessageParams {
  id: string
  workspaceId: string
  userId: string
  streamId: string
  parentMessageId: string | null
  contentJson: JSONContent
  contentMarkdown: string
  attachmentIds: string[]
  metadata: Record<string, string> | null
  scheduledFor: Date
  clientMessageId: string | null
}

export interface ListScheduledOpts {
  status: ScheduledMessageStatus
  streamId?: string
  limit?: number
  cursor?: string
}

const COLUMNS =
  "id, workspace_id, user_id, stream_id, parent_message_id, content_json, content_markdown, attachment_ids, metadata, scheduled_for, status, sent_message_id, last_error, queue_message_id, edit_lock_owner_id, edit_lock_expires_at, client_message_id, retry_count, created_at, updated_at, status_changed_at"

function mapRow(row: ScheduledMessageRow): ScheduledMessage {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    streamId: row.stream_id,
    parentMessageId: row.parent_message_id,
    contentJson: row.content_json,
    contentMarkdown: row.content_markdown,
    attachmentIds: Array.isArray(row.attachment_ids) ? row.attachment_ids : [],
    metadata: row.metadata,
    scheduledFor: row.scheduled_for,
    status: row.status as ScheduledMessageStatus,
    sentMessageId: row.sent_message_id,
    lastError: row.last_error,
    queueMessageId: row.queue_message_id,
    editLockOwnerId: row.edit_lock_owner_id,
    editLockExpiresAt: row.edit_lock_expires_at,
    clientMessageId: row.client_message_id,
    retryCount: row.retry_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    statusChangedAt: row.status_changed_at,
  }
}

export const ScheduledMessagesRepository = {
  /**
   * Insert a new scheduled message. The (workspace_id, user_id,
   * client_message_id) unique index makes the create idempotent across
   * optimistic retries — if the same client_message_id was already inserted,
   * this throws a unique violation and the service catches it to return the
   * existing row.
   */
  async insert(db: Querier, params: InsertScheduledMessageParams): Promise<ScheduledMessage> {
    const result = await db.query<ScheduledMessageRow>(sql`
      INSERT INTO scheduled_messages (
        id, workspace_id, user_id, stream_id, parent_message_id,
        content_json, content_markdown, attachment_ids, metadata,
        scheduled_for, status, client_message_id
      )
      VALUES (
        ${params.id},
        ${params.workspaceId},
        ${params.userId},
        ${params.streamId},
        ${params.parentMessageId},
        ${JSON.stringify(params.contentJson)}::jsonb,
        ${params.contentMarkdown},
        ${JSON.stringify(params.attachmentIds)}::jsonb,
        ${params.metadata ? JSON.stringify(params.metadata) : null}::jsonb,
        ${params.scheduledFor},
        ${ScheduledMessageStatuses.PENDING},
        ${params.clientMessageId}
      )
      RETURNING ${sql.raw(COLUMNS)}
    `)
    return mapRow(result.rows[0]!)
  },

  async findById(db: Querier, workspaceId: string, userId: string, id: string): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      SELECT ${sql.raw(COLUMNS)}
      FROM scheduled_messages
      WHERE id = ${id} AND workspace_id = ${workspaceId} AND user_id = ${userId}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  /**
   * Worker entry point — looks up a row by (workspaceId, id). Used by the
   * fire worker which receives both ids in the queue payload (INV-8: every
   * read filters on workspace_id even when the primary key is unique).
   */
  async findByIdScoped(db: Querier, workspaceId: string, id: string): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      SELECT ${sql.raw(COLUMNS)}
      FROM scheduled_messages
      WHERE id = ${id} AND workspace_id = ${workspaceId}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async findByClientMessageId(
    db: Querier,
    workspaceId: string,
    userId: string,
    clientMessageId: string
  ): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      SELECT ${sql.raw(COLUMNS)}
      FROM scheduled_messages
      WHERE workspace_id = ${workspaceId}
        AND user_id = ${userId}
        AND client_message_id = ${clientMessageId}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  /**
   * List rows for a user filtered by status. `pending` orders by scheduled_for
   * ASC; everything else by status_changed_at DESC. Cursor uses the row id
   * with a workspace_id+user_id-scoped subquery so we can never read a row
   * outside the caller's workspace.
   */
  async listByUser(
    db: Querier,
    workspaceId: string,
    userId: string,
    opts: ListScheduledOpts
  ): Promise<ScheduledMessage[]> {
    const limit = opts.limit ?? 50
    const hasCursor = opts.cursor !== undefined
    const cursor = opts.cursor ?? ""
    const usePending = opts.status === ScheduledMessageStatuses.PENDING
    const streamFilter = opts.streamId ?? null

    if (usePending) {
      const result = await db.query<ScheduledMessageRow>(sql`
        SELECT ${sql.raw(COLUMNS)}
        FROM scheduled_messages
        WHERE workspace_id = ${workspaceId}
          AND user_id = ${userId}
          AND status = ${opts.status}
          AND (${streamFilter}::text IS NULL OR stream_id = ${streamFilter})
          AND (${!hasCursor} OR scheduled_for > (
            SELECT scheduled_for FROM scheduled_messages
            WHERE id = ${cursor} AND workspace_id = ${workspaceId} AND user_id = ${userId}
          ))
        ORDER BY scheduled_for ASC
        LIMIT ${limit}
      `)
      return result.rows.map(mapRow)
    }

    const result = await db.query<ScheduledMessageRow>(sql`
      SELECT ${sql.raw(COLUMNS)}
      FROM scheduled_messages
      WHERE workspace_id = ${workspaceId}
        AND user_id = ${userId}
        AND status = ${opts.status}
        AND (${streamFilter}::text IS NULL OR stream_id = ${streamFilter})
        AND (${!hasCursor} OR status_changed_at < (
          SELECT status_changed_at FROM scheduled_messages
          WHERE id = ${cursor} AND workspace_id = ${workspaceId} AND user_id = ${userId}
        ))
      ORDER BY status_changed_at DESC
      LIMIT ${limit}
    `)
    return result.rows.map(mapRow)
  },

  /**
   * Update content/scheduledFor/attachments/metadata. Returns the updated row
   * or null when no row matched. Caller has already verified the lock token
   * in the service layer; this query also re-asserts the lock owner so a
   * tab-close release between check and update can't slip an unauthorized
   * write through.
   *
   * `scheduledFor`, `contentJson`, `contentMarkdown`, `attachmentIds`, and
   * `metadata` are all optional; passing `undefined` leaves the column
   * untouched. Passing `null` (where allowed) clears it.
   */
  async update(
    db: Querier,
    params: {
      workspaceId: string
      userId: string
      id: string
      lockOwnerId: string
      contentJson?: JSONContent
      contentMarkdown?: string
      attachmentIds?: string[]
      metadata?: Record<string, string> | null
      scheduledFor?: Date
    }
  ): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      UPDATE scheduled_messages SET
        content_json = COALESCE(${
          params.contentJson === undefined ? null : JSON.stringify(params.contentJson)
        }::jsonb, content_json),
        content_markdown = COALESCE(${params.contentMarkdown ?? null}, content_markdown),
        attachment_ids = COALESCE(${
          params.attachmentIds === undefined ? null : JSON.stringify(params.attachmentIds)
        }::jsonb, attachment_ids),
        metadata = CASE
          WHEN ${params.metadata === undefined}::boolean THEN metadata
          ELSE ${params.metadata ? JSON.stringify(params.metadata) : null}::jsonb
        END,
        scheduled_for = COALESCE(${params.scheduledFor ?? null}, scheduled_for),
        updated_at = NOW()
      WHERE id = ${params.id}
        AND workspace_id = ${params.workspaceId}
        AND user_id = ${params.userId}
        AND status = ${ScheduledMessageStatuses.PENDING}
        AND edit_lock_owner_id = ${params.lockOwnerId}
        AND edit_lock_expires_at > NOW()
      RETURNING ${sql.raw(COLUMNS)}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  /**
   * Race-safe lock CAS (INV-20). Used by both the editor `/claim` endpoint
   * and the worker's pre-send check. Acquires the lock when the row is
   * `pending` and either has no lock or the lock has expired.
   *
   * Returns the updated row when the CAS succeeded, null when it failed
   * (status not `pending`, or another owner holds an unexpired lock).
   *
   * `setStatus` is `null` for an editor claim (status stays `pending`) and
   * `'sending'` for the worker's claim (atomic flip).
   */
  async tryAcquireLock(
    db: Querier,
    params: {
      workspaceId: string
      id: string
      ownerId: string
      ttlSeconds: number
      setStatus: ScheduledMessageStatus | null
    }
  ): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      UPDATE scheduled_messages SET
        edit_lock_owner_id = ${params.ownerId},
        edit_lock_expires_at = NOW() + (${params.ttlSeconds} || ' seconds')::interval,
        status = CASE
          WHEN ${params.setStatus}::text IS NULL THEN status
          ELSE ${params.setStatus}::text
        END,
        status_changed_at = CASE
          WHEN ${params.setStatus}::text IS NULL OR ${params.setStatus}::text = status THEN status_changed_at
          ELSE NOW()
        END,
        updated_at = NOW()
      WHERE id = ${params.id}
        AND workspace_id = ${params.workspaceId}
        AND status = ${ScheduledMessageStatuses.PENDING}
        AND (edit_lock_owner_id IS NULL OR edit_lock_expires_at <= NOW() OR edit_lock_owner_id = ${params.ownerId})
      RETURNING ${sql.raw(COLUMNS)}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  /**
   * Refresh the lock TTL. Caller-asserted owner ensures we can't extend
   * someone else's lock. Returns the updated row on success, null when the
   * lock has been released or expired.
   */
  async heartbeatLock(
    db: Querier,
    params: { workspaceId: string; id: string; ownerId: string; ttlSeconds: number }
  ): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      UPDATE scheduled_messages SET
        edit_lock_expires_at = NOW() + (${params.ttlSeconds} || ' seconds')::interval,
        updated_at = NOW()
      WHERE id = ${params.id}
        AND workspace_id = ${params.workspaceId}
        AND edit_lock_owner_id = ${params.ownerId}
        AND edit_lock_expires_at > NOW()
      RETURNING ${sql.raw(COLUMNS)}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  /**
   * Release the lock. Owner-scoped to prevent racing tabs from clobbering
   * each other's locks.
   */
  async releaseLock(
    db: Querier,
    params: { workspaceId: string; id: string; ownerId: string }
  ): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      UPDATE scheduled_messages SET
        edit_lock_owner_id = NULL,
        edit_lock_expires_at = NULL,
        updated_at = NOW()
      WHERE id = ${params.id}
        AND workspace_id = ${params.workspaceId}
        AND edit_lock_owner_id = ${params.ownerId}
      RETURNING ${sql.raw(COLUMNS)}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  /**
   * Mark a row sent. The `sending` status guard makes the transition idempotent
   * — two competing finalizers (worker + atomic-PATCH-when-past-time) can both
   * run their own CAS-to-sending and only one will land.
   */
  async markSent(
    db: Querier,
    params: { workspaceId: string; id: string; sentMessageId: string }
  ): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      UPDATE scheduled_messages SET
        status = ${ScheduledMessageStatuses.SENT},
        sent_message_id = ${params.sentMessageId},
        edit_lock_owner_id = NULL,
        edit_lock_expires_at = NULL,
        last_error = NULL,
        status_changed_at = NOW(),
        updated_at = NOW()
      WHERE id = ${params.id}
        AND workspace_id = ${params.workspaceId}
        AND status = ${ScheduledMessageStatuses.SENDING}
      RETURNING ${sql.raw(COLUMNS)}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async markFailed(
    db: Querier,
    params: { workspaceId: string; id: string; reason: string }
  ): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      UPDATE scheduled_messages SET
        status = ${ScheduledMessageStatuses.FAILED},
        last_error = ${params.reason},
        edit_lock_owner_id = NULL,
        edit_lock_expires_at = NULL,
        status_changed_at = NOW(),
        updated_at = NOW()
      WHERE id = ${params.id}
        AND workspace_id = ${params.workspaceId}
        AND status IN (${ScheduledMessageStatuses.PENDING}, ${ScheduledMessageStatuses.SENDING})
      RETURNING ${sql.raw(COLUMNS)}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async incrementRetryCount(db: Querier, workspaceId: string, id: string): Promise<number> {
    const result = await db.query<{ retry_count: number }>(sql`
      UPDATE scheduled_messages SET
        retry_count = retry_count + 1,
        updated_at = NOW()
      WHERE id = ${id} AND workspace_id = ${workspaceId}
      RETURNING retry_count
    `)
    return result.rows[0]?.retry_count ?? 0
  },

  async setQueueMessageId(db: Querier, workspaceId: string, id: string, queueMessageId: string | null): Promise<void> {
    await db.query(sql`
      UPDATE scheduled_messages SET
        queue_message_id = ${queueMessageId},
        updated_at = NOW()
      WHERE id = ${id} AND workspace_id = ${workspaceId}
    `)
  },

  async cancel(db: Querier, workspaceId: string, userId: string, id: string): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      UPDATE scheduled_messages SET
        status = ${ScheduledMessageStatuses.CANCELLED},
        edit_lock_owner_id = NULL,
        edit_lock_expires_at = NULL,
        status_changed_at = NOW(),
        updated_at = NOW()
      WHERE id = ${id}
        AND workspace_id = ${workspaceId}
        AND user_id = ${userId}
        AND status = ${ScheduledMessageStatuses.PENDING}
      RETURNING ${sql.raw(COLUMNS)}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },
}
