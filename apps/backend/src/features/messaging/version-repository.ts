import type { Querier } from "../../db"
import { sql } from "../../db"
import type { JSONContent } from "@threa/types"

interface MessageVersionRow {
  id: string
  message_id: string
  version_number: number
  content_json: JSONContent
  content_markdown: string
  edited_by: string
  created_at: Date
}

export interface MessageVersion {
  id: string
  messageId: string
  versionNumber: number
  contentJson: JSONContent
  contentMarkdown: string
  editedBy: string
  createdAt: Date
}

interface InsertParams {
  id: string
  messageId: string
  contentJson: JSONContent
  contentMarkdown: string
  editedBy: string
}

function mapRow(row: MessageVersionRow): MessageVersion {
  return {
    id: row.id,
    messageId: row.message_id,
    versionNumber: row.version_number,
    contentJson: row.content_json,
    contentMarkdown: row.content_markdown,
    editedBy: row.edited_by,
    createdAt: row.created_at,
  }
}

export const MessageVersionRepository = {
  async insert(db: Querier, params: InsertParams): Promise<MessageVersion> {
    const result = await db.query<MessageVersionRow>(sql`
      INSERT INTO message_versions (id, message_id, version_number, content_json, content_markdown, edited_by)
      VALUES (
        ${params.id},
        ${params.messageId},
        COALESCE((SELECT MAX(version_number) FROM message_versions WHERE message_id = ${params.messageId}), 0) + 1,
        ${JSON.stringify(params.contentJson)},
        ${params.contentMarkdown},
        ${params.editedBy}
      )
      RETURNING *
    `)
    if (!result.rows[0]) throw new Error(`Failed to insert message version for ${params.messageId}`)
    return mapRow(result.rows[0])
  },

  async listByMessageId(db: Querier, messageId: string): Promise<MessageVersion[]> {
    const result = await db.query<MessageVersionRow>(sql`
      SELECT * FROM message_versions
      WHERE message_id = ${messageId}
      ORDER BY version_number ASC
    `)
    return result.rows.map(mapRow)
  },
}
