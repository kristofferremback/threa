import type { ScheduledMessageView } from "@threa/types"
import type { Querier } from "../../db"
import { StreamRepository } from "../streams"
import type { ScheduledMessage } from "./repository"

export async function resolveScheduledView(
  db: Querier,
  _userId: string,
  rows: ScheduledMessage[]
): Promise<ScheduledMessageView[]> {
  if (rows.length === 0) return []

  const streamIds = Array.from(new Set(rows.map((r) => r.streamId).filter(Boolean) as string[]))
  const streams = streamIds.length > 0 ? await StreamRepository.findByIds(db, streamIds) : []
  const streamById = new Map(streams.map((s) => [s.id, s]))

  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    authorId: row.authorId,
    streamId: row.streamId,
    parentMessageId: row.parentMessageId,
    parentStreamId: row.parentStreamId,
    contentJson: row.contentJson,
    contentMarkdown: row.contentMarkdown,
    attachmentIds: row.attachmentIds,
    scheduledAt: row.scheduledAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    pausedAt: row.pausedAt?.toISOString() ?? null,
    messageId: row.messageId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    streamDisplayName: row.streamId ? (streamById.get(row.streamId)?.displayName ?? null) : null,
  }))
}
