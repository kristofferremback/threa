import type { Querier } from "../../db"
import { sql } from "../../db"
import { scheduledMessageId } from "../../lib/id"
import { ScheduledMessageStatuses, type JSONContent, type ScheduledMessageStatus } from "@threa/types"

interface ScheduledMessageRow {
  id: string
  workspace_id: string
  user_id: string
  stream_id: string
  status: string
  scheduled_at: Date
  content_json: JSONContent
  content_markdown: string
  attachment_ids: string[]
  client_message_id: string
  queue_message_id: string | null
  sent_message_id: string | null
  edit_previous_status: string | null
  version: number
  firing_started_at: Date | null
  sent_at: Date | null
  deleted_at: Date | null
  failed_at: Date | null
  failure_reason: string | null
  created_at: Date
  updated_at: Date
}

export interface ScheduledMessage {
  id: string
  workspaceId: string
  userId: string
  streamId: string
  status: ScheduledMessageStatus
  scheduledAt: Date
  contentJson: JSONContent
  contentMarkdown: string
  attachmentIds: string[]
  clientMessageId: string
  queueMessageId: string | null
  sentMessageId: string | null
  editPreviousStatus: ScheduledMessageStatus | null
  version: number
  firingStartedAt: Date | null
  sentAt: Date | null
  deletedAt: Date | null
  failedAt: Date | null
  failureReason: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateScheduledMessageParams {
  workspaceId: string
  userId: string
  streamId: string
  scheduledAt: Date
  contentJson: JSONContent
  contentMarkdown: string
  attachmentIds: string[]
  clientMessageId: string
}

export interface UpdateScheduledMessageParams {
  contentJson?: JSONContent
  contentMarkdown?: string
  attachmentIds?: string[]
  scheduledAt?: Date
  status?: typeof ScheduledMessageStatuses.SCHEDULED | typeof ScheduledMessageStatuses.PAUSED
  queueMessageId?: string | null
  expectedVersion?: number
}

const COLUMNS = sql.raw(`
  id, workspace_id, user_id, stream_id, status, scheduled_at, content_json,
  content_markdown, attachment_ids, client_message_id, queue_message_id,
  sent_message_id, edit_previous_status, version, sent_at, deleted_at,
  firing_started_at, failed_at, failure_reason, created_at, updated_at
`)

function mapRow(row: ScheduledMessageRow): ScheduledMessage {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    streamId: row.stream_id,
    status: row.status as ScheduledMessageStatus,
    scheduledAt: row.scheduled_at,
    contentJson: row.content_json,
    contentMarkdown: row.content_markdown,
    attachmentIds: row.attachment_ids ?? [],
    clientMessageId: row.client_message_id,
    queueMessageId: row.queue_message_id,
    sentMessageId: row.sent_message_id,
    editPreviousStatus: row.edit_previous_status as ScheduledMessageStatus | null,
    version: row.version,
    firingStartedAt: row.firing_started_at,
    sentAt: row.sent_at,
    deletedAt: row.deleted_at,
    failedAt: row.failed_at,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const ScheduledMessagesRepository = {
  async create(db: Querier, params: CreateScheduledMessageParams): Promise<ScheduledMessage> {
    const result = await db.query<ScheduledMessageRow>(sql`
      INSERT INTO scheduled_messages (
        id, workspace_id, user_id, stream_id, status, scheduled_at,
        content_json, content_markdown, attachment_ids, client_message_id
      )
      VALUES (
        ${scheduledMessageId()}, ${params.workspaceId}, ${params.userId}, ${params.streamId},
        ${ScheduledMessageStatuses.SCHEDULED}, ${params.scheduledAt}, ${JSON.stringify(params.contentJson)}::jsonb,
        ${params.contentMarkdown}, ${params.attachmentIds}, ${params.clientMessageId}
      )
      RETURNING ${COLUMNS}
    `)
    return mapRow(result.rows[0]!)
  },

  async listByUser(db: Querier, workspaceId: string, userId: string): Promise<ScheduledMessage[]> {
    const result = await db.query<ScheduledMessageRow>(sql`
      SELECT ${COLUMNS}
      FROM scheduled_messages
      WHERE workspace_id = ${workspaceId}
        AND user_id = ${userId}
        AND status <> ${ScheduledMessageStatuses.DELETED}
      ORDER BY
        CASE WHEN status IN (${ScheduledMessageStatuses.SCHEDULED}, ${ScheduledMessageStatuses.PAUSED}, ${ScheduledMessageStatuses.EDITING}, ${ScheduledMessageStatuses.FAILED}) THEN 0 ELSE 1 END,
        scheduled_at ASC,
        updated_at DESC
    `)
    return result.rows.map(mapRow)
  },

  async findById(db: Querier, workspaceId: string, userId: string, id: string): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      SELECT ${COLUMNS}
      FROM scheduled_messages
      WHERE id = ${id} AND workspace_id = ${workspaceId} AND user_id = ${userId}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async update(
    db: Querier,
    workspaceId: string,
    userId: string,
    id: string,
    params: UpdateScheduledMessageParams
  ): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      UPDATE scheduled_messages
      SET
        content_json = COALESCE(${params.contentJson ? JSON.stringify(params.contentJson) : null}::jsonb, content_json),
        content_markdown = COALESCE(${params.contentMarkdown ?? null}, content_markdown),
        attachment_ids = COALESCE(${params.attachmentIds ?? null}, attachment_ids),
        scheduled_at = COALESCE(${params.scheduledAt ?? null}, scheduled_at),
        status = COALESCE(${params.status ?? null}, status),
        queue_message_id = ${params.queueMessageId === undefined ? sql.raw("queue_message_id") : params.queueMessageId},
        edit_previous_status = NULL,
        firing_started_at = NULL,
        version = version + 1,
        updated_at = NOW(),
        failed_at = NULL,
        failure_reason = NULL
      WHERE id = ${id}
        AND workspace_id = ${workspaceId}
        AND user_id = ${userId}
        AND status IN (${ScheduledMessageStatuses.SCHEDULED}, ${ScheduledMessageStatuses.PAUSED}, ${ScheduledMessageStatuses.EDITING}, ${ScheduledMessageStatuses.FAILED})
        AND (${params.expectedVersion === undefined} OR version = ${params.expectedVersion ?? 0})
      RETURNING ${COLUMNS}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async setQueueMessageId(
    db: Querier,
    row: ScheduledMessage,
    queueMessageId: string | null
  ): Promise<ScheduledMessage> {
    const result = await db.query<ScheduledMessageRow>(sql`
      UPDATE scheduled_messages
      SET queue_message_id = ${queueMessageId}, updated_at = NOW()
      WHERE id = ${row.id}
      RETURNING ${COLUMNS}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : row
  },

  async markEditing(
    db: Querier,
    workspaceId: string,
    userId: string,
    id: string,
    expectedVersion?: number
  ): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      UPDATE scheduled_messages
      SET
        status = ${ScheduledMessageStatuses.EDITING},
        edit_previous_status = status,
        queue_message_id = NULL,
        firing_started_at = NULL,
        version = version + 1,
        updated_at = NOW()
      WHERE id = ${id}
        AND workspace_id = ${workspaceId}
        AND user_id = ${userId}
        AND status IN (${ScheduledMessageStatuses.SCHEDULED}, ${ScheduledMessageStatuses.PAUSED}, ${ScheduledMessageStatuses.FAILED})
        AND (${expectedVersion === undefined} OR version = ${expectedVersion ?? 0})
      RETURNING ${COLUMNS}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async markDeleted(
    db: Querier,
    workspaceId: string,
    userId: string,
    id: string,
    expectedVersion?: number
  ): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      UPDATE scheduled_messages
      SET
        status = ${ScheduledMessageStatuses.DELETED},
        queue_message_id = NULL,
        firing_started_at = NULL,
        deleted_at = NOW(),
        version = version + 1,
        updated_at = NOW()
      WHERE id = ${id}
        AND workspace_id = ${workspaceId}
        AND user_id = ${userId}
        AND status IN (${ScheduledMessageStatuses.SCHEDULED}, ${ScheduledMessageStatuses.PAUSED}, ${ScheduledMessageStatuses.EDITING}, ${ScheduledMessageStatuses.FAILED})
        AND (${expectedVersion === undefined} OR version = ${expectedVersion ?? 0})
      RETURNING ${COLUMNS}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async claimDueForFire(db: Querier, id: string, now: Date, staleBefore: Date): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      UPDATE scheduled_messages
      SET
        status = ${ScheduledMessageStatuses.FIRING},
        firing_started_at = ${now},
        version = version + 1,
        updated_at = NOW()
      WHERE id = ${id}
        AND (
          (status = ${ScheduledMessageStatuses.SCHEDULED} AND scheduled_at <= ${now})
          OR (status = ${ScheduledMessageStatuses.FIRING} AND firing_started_at <= ${staleBefore})
        )
      RETURNING ${COLUMNS}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async markSent(db: Querier, id: string, sentMessageId: string): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      UPDATE scheduled_messages
      SET
        status = ${ScheduledMessageStatuses.SENT},
        sent_message_id = ${sentMessageId},
        sent_at = NOW(),
        queue_message_id = NULL,
        firing_started_at = NULL,
        version = version + 1,
        updated_at = NOW()
      WHERE id = ${id}
        AND status = ${ScheduledMessageStatuses.FIRING}
      RETURNING ${COLUMNS}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async markFailed(db: Querier, id: string, reason: string): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      UPDATE scheduled_messages
      SET
        status = ${ScheduledMessageStatuses.FAILED},
        failed_at = NOW(),
        failure_reason = ${reason},
        queue_message_id = NULL,
        firing_started_at = NULL,
        version = version + 1,
        updated_at = NOW()
      WHERE id = ${id}
        AND status = ${ScheduledMessageStatuses.FIRING}
      RETURNING ${COLUMNS}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },
}
