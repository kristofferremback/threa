import type { ScheduledMessageView } from "@threa/types"
import type { Querier } from "../../db"
import { StreamRepository } from "../streams"
import type { ScheduledMessage } from "./repository"

export async function resolveScheduledView(db: Querier, rows: ScheduledMessage[]): Promise<ScheduledMessageView[]> {
  if (rows.length === 0) return []
  const streamIds = Array.from(new Set(rows.map((row) => row.streamId)))
  const streams = await StreamRepository.findByIds(db, streamIds)
  const streamById = new Map(streams.map((stream) => [stream.id, stream]))

  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    streamId: row.streamId,
    status: row.status,
    scheduledAt: row.scheduledAt.toISOString(),
    contentJson: row.contentJson,
    contentMarkdown: row.contentMarkdown,
    attachmentIds: row.attachmentIds,
    sentMessageId: row.sentMessageId,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    failedAt: row.failedAt?.toISOString() ?? null,
    failureReason: row.failureReason,
    streamName: streamById.get(row.streamId)?.displayName ?? null,
  }))
}
