import type { Querier } from "../../db"
import { sql } from "../../db"
import { scheduledMessageId } from "../../lib/id"
import type { JSONContent } from "@threa/types"

interface ScheduledMessageRow {
  id: string
  workspace_id: string
  author_id: string
  stream_id: string | null
  parent_message_id: string | null
  parent_stream_id: string | null
  content_json: JSONContent
  content_markdown: string
  attachment_ids: string[]
  scheduled_at: Date
  sent_at: Date | null
  cancelled_at: Date | null
  paused_at: Date | null
  message_id: string | null
  created_at: Date
  updated_at: Date
}

export interface ScheduledMessage {
  id: string
  workspaceId: string
  authorId: string
  streamId: string | null
  parentMessageId: string | null
  parentStreamId: string | null
  contentJson: JSONContent
  contentMarkdown: string
  attachmentIds: string[]
  scheduledAt: Date
  sentAt: Date | null
  cancelledAt: Date | null
  pausedAt: Date | null
  messageId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface InsertScheduledParams {
  workspaceId: string
  authorId: string
  streamId: string | null
  parentMessageId: string | null
  parentStreamId: string | null
  contentJson: JSONContent
  contentMarkdown: string
  attachmentIds: string[]
  scheduledAt: Date
}

const SCHEDULED_MESSAGE_COLUMNS =
  "id, workspace_id, author_id, stream_id, parent_message_id, parent_stream_id, content_json, content_markdown, attachment_ids, scheduled_at, sent_at, cancelled_at, paused_at, message_id, created_at, updated_at"

function mapRow(row: ScheduledMessageRow): ScheduledMessage {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    authorId: row.author_id,
    streamId: row.stream_id,
    parentMessageId: row.parent_message_id,
    parentStreamId: row.parent_stream_id,
    contentJson: row.content_json,
    contentMarkdown: row.content_markdown,
    attachmentIds: row.attachment_ids,
    scheduledAt: row.scheduled_at,
    sentAt: row.sent_at,
    cancelledAt: row.cancelled_at,
    pausedAt: row.paused_at,
    messageId: row.message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const ScheduledMessagesRepository = {
  async insert(db: Querier, params: InsertScheduledParams): Promise<ScheduledMessage> {
    const id = scheduledMessageId()
    const result = await db.query<ScheduledMessageRow>(sql`
      INSERT INTO scheduled_messages (
        id, workspace_id, author_id, stream_id, parent_message_id, parent_stream_id,
        content_json, content_markdown, attachment_ids, scheduled_at
      )
      VALUES (
        ${id}, ${params.workspaceId}, ${params.authorId},
        ${params.streamId}, ${params.parentMessageId}, ${params.parentStreamId},
        ${params.contentJson as object}::jsonb, ${params.contentMarkdown},
        ${params.attachmentIds}::text[], ${params.scheduledAt}
      )
      RETURNING ${sql.raw(SCHEDULED_MESSAGE_COLUMNS)}
    `)
    return mapRow(result.rows[0]!)
  },

  async findById(
    db: Querier,
    workspaceId: string,
    authorId: string,
    scheduledId: string
  ): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      SELECT ${sql.raw(SCHEDULED_MESSAGE_COLUMNS)}
      FROM scheduled_messages
      WHERE id = ${scheduledId}
        AND workspace_id = ${workspaceId}
        AND author_id = ${authorId}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  /** Worker-scoped lookup — no user_id filter. */
  async findByIdUnscoped(db: Querier, scheduledId: string): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      SELECT ${sql.raw(SCHEDULED_MESSAGE_COLUMNS)}
      FROM scheduled_messages
      WHERE id = ${scheduledId}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async findByUser(
    db: Querier,
    workspaceId: string,
    authorId: string,
    streamId?: string
  ): Promise<ScheduledMessage[]> {
    if (streamId) {
      const result = await db.query<ScheduledMessageRow>(sql`
        SELECT ${sql.raw(SCHEDULED_MESSAGE_COLUMNS)}
        FROM scheduled_messages
        WHERE workspace_id = ${workspaceId}
          AND author_id = ${authorId}
          AND stream_id = ${streamId}
        ORDER BY scheduled_at ASC
      `)
      return result.rows.map(mapRow)
    }
    const result = await db.query<ScheduledMessageRow>(sql`
      SELECT ${sql.raw(SCHEDULED_MESSAGE_COLUMNS)}
      FROM scheduled_messages
      WHERE workspace_id = ${workspaceId}
        AND author_id = ${authorId}
      ORDER BY scheduled_at ASC
    `)
    return result.rows.map(mapRow)
  },

  async updateContent(
    db: Querier,
    workspaceId: string,
    authorId: string,
    scheduledId: string,
    params: { contentJson: JSONContent; contentMarkdown: string; attachmentIds: string[] }
  ): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      UPDATE scheduled_messages SET
        content_json = ${params.contentJson as object}::jsonb,
        content_markdown = ${params.contentMarkdown},
        attachment_ids = ${params.attachmentIds}::text[],
        updated_at = NOW()
      WHERE id = ${scheduledId}
        AND workspace_id = ${workspaceId}
        AND author_id = ${authorId}
      RETURNING ${sql.raw(SCHEDULED_MESSAGE_COLUMNS)}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async updateScheduledAt(
    db: Querier,
    workspaceId: string,
    authorId: string,
    scheduledId: string,
    scheduledAt: Date
  ): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      UPDATE scheduled_messages SET
        scheduled_at = ${scheduledAt},
        updated_at = NOW()
      WHERE id = ${scheduledId}
        AND workspace_id = ${workspaceId}
        AND author_id = ${authorId}
      RETURNING ${sql.raw(SCHEDULED_MESSAGE_COLUMNS)}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async markPaused(
    db: Querier,
    workspaceId: string,
    authorId: string,
    scheduledId: string,
    pausedAt: Date
  ): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      UPDATE scheduled_messages SET
        paused_at = ${pausedAt},
        updated_at = NOW()
      WHERE id = ${scheduledId}
        AND workspace_id = ${workspaceId}
        AND author_id = ${authorId}
        AND sent_at IS NULL
        AND cancelled_at IS NULL
      RETURNING ${sql.raw(SCHEDULED_MESSAGE_COLUMNS)}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async markResumed(
    db: Querier,
    workspaceId: string,
    authorId: string,
    scheduledId: string
  ): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      UPDATE scheduled_messages SET
        paused_at = NULL,
        updated_at = NOW()
      WHERE id = ${scheduledId}
        AND workspace_id = ${workspaceId}
        AND author_id = ${authorId}
        AND sent_at IS NULL
        AND cancelled_at IS NULL
      RETURNING ${sql.raw(SCHEDULED_MESSAGE_COLUMNS)}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async markSent(
    db: Querier,
    workspaceId: string,
    scheduledId: string,
    sentAt: Date,
    messageId: string
  ): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      UPDATE scheduled_messages SET
        sent_at = ${sentAt},
        message_id = ${messageId},
        updated_at = NOW()
      WHERE id = ${scheduledId}
        AND workspace_id = ${workspaceId}
        AND sent_at IS NULL
        AND cancelled_at IS NULL
      RETURNING ${sql.raw(SCHEDULED_MESSAGE_COLUMNS)}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },

  async markCancelled(
    db: Querier,
    workspaceId: string,
    authorId: string,
    scheduledId: string,
    cancelledAt: Date
  ): Promise<ScheduledMessage | null> {
    const result = await db.query<ScheduledMessageRow>(sql`
      UPDATE scheduled_messages SET
        cancelled_at = ${cancelledAt},
        updated_at = NOW()
      WHERE id = ${scheduledId}
        AND workspace_id = ${workspaceId}
        AND author_id = ${authorId}
        AND sent_at IS NULL
      RETURNING ${sql.raw(SCHEDULED_MESSAGE_COLUMNS)}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },
}
