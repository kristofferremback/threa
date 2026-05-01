import type { Pool } from "pg"
import { AuthorTypes, type ScheduledMessageView } from "@threa/types"
import { withTransaction, sql } from "../../db"
import { HttpError } from "../../lib/errors"
import { logger } from "../../lib/logger"
import { JobQueues, QueueRepository } from "../../lib/queue"
import { OutboxRepository } from "../../lib/outbox"
import { EventService, MessageRepository } from "../messaging"
import { isUniqueViolation } from "@threa/backend-common"
import { queueId } from "../../lib/id"
import { ScheduledMessagesRepository, type ScheduledMessage, type InsertScheduledParams } from "./repository"
import { resolveScheduledView } from "./view"

interface ScheduledMessagesServiceDeps {
  pool: Pool
  eventService: EventService
}

export interface ScheduleParams {
  workspaceId: string
  authorId: string
  streamId: string | null
  parentMessageId: string | null
  parentStreamId: string | null
  contentJson: import("@threa/types").JSONContent
  contentMarkdown: string
  attachmentIds: string[]
  scheduledAt: Date
}

export interface UpdateScheduledParams {
  workspaceId: string
  authorId: string
  scheduledId: string
  contentJson?: import("@threa/types").JSONContent
  contentMarkdown?: string
  attachmentIds?: string[]
  scheduledAt?: Date
}

export class ScheduledMessagesService {
  private readonly pool: Pool
  private readonly eventService: EventService

  constructor(deps: ScheduledMessagesServiceDeps) {
    this.pool = deps.pool
    this.eventService = deps.eventService
  }

  async schedule(params: ScheduleParams): Promise<{ view: ScheduledMessageView; sentNow: boolean }> {
    const clampedAt = clampScheduledAt(params.scheduledAt)
    const isPast = clampedAt.getTime() <= Date.now()

    if (isPast) {
      return this.scheduleAndSendNow(params)
    }

    return withTransaction(this.pool, async (client) => {
      const row = await ScheduledMessagesRepository.insert(client, {
        workspaceId: params.workspaceId,
        authorId: params.authorId,
        streamId: params.streamId,
        parentMessageId: params.parentMessageId,
        parentStreamId: params.parentStreamId,
        contentJson: params.contentJson,
        contentMarkdown: params.contentMarkdown,
        attachmentIds: params.attachmentIds,
        scheduledAt: clampedAt,
      })

      await enqueueFireJob(client, {
        workspaceId: params.workspaceId,
        authorId: params.authorId,
        scheduledId: row.id,
        scheduledAt: clampedAt,
      })

      const [view] = await resolveScheduledView(client, params.authorId, [row])

      await OutboxRepository.insert(client, "scheduled_message:created", {
        workspaceId: params.workspaceId,
        targetUserId: params.authorId,
        scheduled: view!,
      })

      return { view: view!, sentNow: false }
    })
  }

  private async scheduleAndSendNow(params: ScheduleParams): Promise<{ view: ScheduledMessageView; sentNow: boolean }> {
    return withTransaction(this.pool, async (client) => {
      const targetStreamId = await resolveTargetStream(client, {
        streamId: params.streamId,
        parentMessageId: params.parentMessageId,
      })
      if (!targetStreamId) {
        throw new HttpError("Could not resolve target stream for scheduled message", {
          status: 400,
          code: "SCHEDULED_NO_TARGET",
        })
      }

      const row = await ScheduledMessagesRepository.insert(client, {
        workspaceId: params.workspaceId,
        authorId: params.authorId,
        streamId: targetStreamId,
        parentMessageId: params.parentMessageId,
        parentStreamId: params.parentStreamId,
        contentJson: params.contentJson,
        contentMarkdown: params.contentMarkdown,
        attachmentIds: params.attachmentIds,
        scheduledAt: new Date(),
      })

      const clientMessageId = `scheduled:${row.id}`
      const { id: messageId } = await this.eventService.createMessage({
        workspaceId: params.workspaceId,
        streamId: targetStreamId,
        authorId: params.authorId,
        authorType: AuthorTypes.USER,
        contentJson: params.contentJson,
        contentMarkdown: params.contentMarkdown,
        attachmentIds: params.attachmentIds.length > 0 ? params.attachmentIds : undefined,
        clientMessageId,
      })

      const now = new Date()
      const sentRow = await ScheduledMessagesRepository.markSent(client, row.workspaceId, row.id, now, messageId!)
      if (!sentRow) {
        throw new HttpError("Scheduled message state changed unexpectedly", { status: 409 })
      }

      const [view] = await resolveScheduledView(client, params.authorId, [sentRow])

      await OutboxRepository.insert(client, "scheduled_message:created", {
        workspaceId: params.workspaceId,
        targetUserId: params.authorId,
        scheduled: view!,
      })

      await OutboxRepository.insert(client, "scheduled_message:fired", {
        workspaceId: params.workspaceId,
        targetUserId: params.authorId,
        scheduledId: row.id,
      })

      return { view: view!, sentNow: true }
    })
  }

  async update(params: UpdateScheduledParams): Promise<ScheduledMessageView> {
    const clampedAt = params.scheduledAt !== undefined ? clampScheduledAt(params.scheduledAt) : null
    const isSendNow = clampedAt !== null && clampedAt.getTime() <= Date.now()
    const hasContent =
      params.contentJson !== undefined || params.contentMarkdown !== undefined || params.attachmentIds !== undefined

    if (isSendNow) {
      if (hasContent) {
        await withTransaction(this.pool, async (client) => {
          const existing = await ScheduledMessagesRepository.findById(
            client, params.workspaceId, params.authorId, params.scheduledId
          )
          if (!existing) {
            throw new HttpError("Scheduled message not found", { status: 404, code: "SCHEDULED_NOT_FOUND" })
          }
          if (existing.sentAt || existing.cancelledAt) {
            throw new HttpError("Scheduled message has already been sent or cancelled", {
              status: 409, code: "SCHEDULED_NOT_PENDING",
            })
          }
          await ScheduledMessagesRepository.updateContent(
            client, params.workspaceId, params.authorId, params.scheduledId,
            {
              contentJson: params.contentJson ?? existing.contentJson,
              contentMarkdown: params.contentMarkdown ?? existing.contentMarkdown,
              attachmentIds: params.attachmentIds ?? existing.attachmentIds,
            }
          )
        })
      }

      await this.fire({ scheduledId: params.scheduledId })

      const row = await ScheduledMessagesRepository.findByIdUnscoped(this.pool, params.scheduledId)
      const [view] = await resolveScheduledView(this.pool, params.authorId, row ? [row] : [])
      return view!
    }

    return withTransaction(this.pool, async (client) => {
      const existing = await ScheduledMessagesRepository.findById(
        client, params.workspaceId, params.authorId, params.scheduledId
      )
      if (!existing) {
        throw new HttpError("Scheduled message not found", { status: 404, code: "SCHEDULED_NOT_FOUND" })
      }
      if (existing.sentAt || existing.cancelledAt) {
        throw new HttpError("Scheduled message has already been sent or cancelled", {
          status: 409, code: "SCHEDULED_NOT_PENDING",
        })
      }

      let row = existing

      if (hasContent) {
        const updated = await ScheduledMessagesRepository.updateContent(
          client, params.workspaceId, params.authorId, params.scheduledId,
          {
            contentJson: params.contentJson ?? existing.contentJson,
            contentMarkdown: params.contentMarkdown ?? existing.contentMarkdown,
            attachmentIds: params.attachmentIds ?? existing.attachmentIds,
          }
        )
        if (updated) {
          row = updated
          // Auto-resume on content save — clear paused state
          if (existing.pausedAt) {
            const resumed = await ScheduledMessagesRepository.markResumed(
              client, params.workspaceId, params.authorId, params.scheduledId
            )
            if (resumed) row = resumed
          }
        }
      }

      if (params.scheduledAt !== undefined) {
        const modifiedClampedAt = clampScheduledAt(params.scheduledAt)
        const updated = await ScheduledMessagesRepository.updateScheduledAt(
          client, params.workspaceId, params.authorId, params.scheduledId, modifiedClampedAt
        )
        if (updated) row = updated
      }

      const [view] = await resolveScheduledView(client, params.authorId, [row])

      await OutboxRepository.insert(client, "scheduled_message:updated", {
        workspaceId: params.workspaceId,
        targetUserId: params.authorId,
        scheduled: view!,
      })

      return view!
    })
  }

  async cancel(params: { workspaceId: string; authorId: string; scheduledId: string }): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const existing = await ScheduledMessagesRepository.findById(
        client, params.workspaceId, params.authorId, params.scheduledId
      )
      if (!existing) {
        throw new HttpError("Scheduled message not found", { status: 404, code: "SCHEDULED_NOT_FOUND" })
      }
      if (existing.sentAt) {
        throw new HttpError("Scheduled message has already been sent", {
          status: 409, code: "SCHEDULED_ALREADY_SENT",
        })
      }
      if (existing.cancelledAt) {
        return
      }

      await ScheduledMessagesRepository.markCancelled(
        client, params.workspaceId, params.authorId, params.scheduledId, new Date()
      )

      await OutboxRepository.insert(client, "scheduled_message:cancelled", {
        workspaceId: params.workspaceId,
        targetUserId: params.authorId,
        scheduledId: params.scheduledId,
      })
    })
  }

  async pause(params: { workspaceId: string; authorId: string; scheduledId: string }): Promise<ScheduledMessageView> {
    return withTransaction(this.pool, async (client) => {
      const existing = await ScheduledMessagesRepository.findById(
        client, params.workspaceId, params.authorId, params.scheduledId
      )
      if (!existing) {
        throw new HttpError("Scheduled message not found", { status: 404, code: "SCHEDULED_NOT_FOUND" })
      }
      if (existing.sentAt || existing.cancelledAt) {
        throw new HttpError("Scheduled message has already been sent or cancelled", {
          status: 409, code: "SCHEDULED_NOT_PENDING",
        })
      }
      if (existing.pausedAt) {
        const [view] = await resolveScheduledView(client, params.authorId, [existing])
        return view!
      }

      const paused = await ScheduledMessagesRepository.markPaused(
        client, params.workspaceId, params.authorId, params.scheduledId, new Date()
      )
      if (!paused) {
        throw new HttpError("Scheduled message state changed unexpectedly", { status: 409 })
      }

      const [view] = await resolveScheduledView(client, params.authorId, [paused])

      await OutboxRepository.insert(client, "scheduled_message:updated", {
        workspaceId: params.workspaceId,
        targetUserId: params.authorId,
        scheduled: view!,
      })

      return view!
    })
  }

  async resume(params: { workspaceId: string; authorId: string; scheduledId: string }): Promise<ScheduledMessageView> {
    return withTransaction(this.pool, async (client) => {
      const existing = await ScheduledMessagesRepository.findById(
        client, params.workspaceId, params.authorId, params.scheduledId
      )
      if (!existing) {
        throw new HttpError("Scheduled message not found", { status: 404, code: "SCHEDULED_NOT_FOUND" })
      }
      if (existing.sentAt || existing.cancelledAt) {
        throw new HttpError("Scheduled message has already been sent or cancelled", {
          status: 409, code: "SCHEDULED_NOT_PENDING",
        })
      }
      if (!existing.pausedAt) {
        const [view] = await resolveScheduledView(client, params.authorId, [existing])
        return view!
      }

      const resumed = await ScheduledMessagesRepository.markResumed(
        client, params.workspaceId, params.authorId, params.scheduledId
      )
      if (!resumed) {
        throw new HttpError("Scheduled message state changed unexpectedly", { status: 409 })
      }

      await enqueueFireJob(client, {
        workspaceId: params.workspaceId,
        authorId: params.authorId,
        scheduledId: params.scheduledId,
        scheduledAt: resumed.scheduledAt,
      })

      const [view] = await resolveScheduledView(client, params.authorId, [resumed])

      await OutboxRepository.insert(client, "scheduled_message:updated", {
        workspaceId: params.workspaceId,
        targetUserId: params.authorId,
        scheduled: view!,
      })

      return view!
    })
  }

  async listByUser(params: {
    workspaceId: string
    authorId: string
    streamId?: string
  }): Promise<ScheduledMessageView[]> {
    const rows = await ScheduledMessagesRepository.findByUser(
      this.pool, params.workspaceId, params.authorId, params.streamId
    )
    return resolveScheduledView(this.pool, params.authorId, rows)
  }

  async fire(params: { scheduledId: string }): Promise<{ fired: boolean; messageId?: string }> {
    const row = await ScheduledMessagesRepository.findByIdUnscoped(this.pool, params.scheduledId)
    if (!row || row.sentAt || row.cancelledAt || row.pausedAt) {
      return { fired: false }
    }

    const targetStreamId = await resolveTargetStream(this.pool, {
      streamId: row.streamId,
      parentMessageId: row.parentMessageId,
    })
    if (!targetStreamId) {
      logger.warn(
        { scheduledId: params.scheduledId, streamId: row.streamId, parentMessageId: row.parentMessageId },
        "Scheduled message: could not resolve target stream"
      )
      return { fired: false }
    }

    const clientMessageId = `scheduled:${params.scheduledId}`
    try {
      const { id: messageId } = await this.eventService.createMessage({
        workspaceId: row.workspaceId,
        streamId: targetStreamId,
        authorId: row.authorId,
        authorType: AuthorTypes.USER,
        contentJson: row.contentJson,
        contentMarkdown: row.contentMarkdown,
        attachmentIds: row.attachmentIds.length > 0 ? row.attachmentIds : undefined,
        clientMessageId,
      })

      return withTransaction(this.pool, async (client) => {
        const now = new Date()
        const updated = await ScheduledMessagesRepository.markSent(
          client, row.workspaceId, params.scheduledId, now, messageId!
        )
        if (!updated) return { fired: false }

        await OutboxRepository.insert(client, "scheduled_message:fired", {
          workspaceId: row.workspaceId,
          targetUserId: row.authorId,
          scheduledId: params.scheduledId,
        })

        logger.info(
          { scheduledId: params.scheduledId, workspaceId: row.workspaceId, targetStreamId, messageId: messageId! },
          "Scheduled message fired"
        )
        return { fired: true, messageId: messageId! }
      })
    } catch (err) {
      logger.error(
        { err, scheduledId: params.scheduledId, targetStreamId },
        "Scheduled message: failed to create message"
      )
      throw err
    }
  }
}

async function resolveTargetStream(
  db: import("../../db").Querier,
  params: { streamId: string | null; parentMessageId: string | null }
): Promise<string | null> {
  if (params.streamId) return params.streamId

  if (params.parentMessageId) {
    const parentMessage = await MessageRepository.findById(db, params.parentMessageId)
    if (!parentMessage) return null
    const threadResult = await (db as Pool).query<{ id: string }>(
      sql`SELECT id FROM streams WHERE parent_message_id = ${params.parentMessageId}`
    )
    if (threadResult.rows.length > 0) return threadResult.rows[0].id
    return parentMessage.streamId
  }

  return null
}

async function enqueueFireJob(
  client: import("pg").PoolClient,
  params: {
    workspaceId: string
    authorId: string
    scheduledId: string
    scheduledAt: Date
  }
): Promise<void> {
  const now = new Date()
  const payload = {
    workspaceId: params.workspaceId,
    authorId: params.authorId,
    scheduledMessageId: params.scheduledId,
  }

  for (let attempt = 1; attempt <= 5; attempt++) {
    const queueMessageId = queueId()
    try {
      await QueueRepository.insert(client, {
        id: queueMessageId,
        queueName: JobQueues.SCHEDULED_MESSAGE_FIRE,
        workspaceId: params.workspaceId,
        payload,
        processAfter: params.scheduledAt,
        insertedAt: now,
      })
      return
    } catch (err) {
      if (!isUniqueViolation(err, "queue_messages_pkey")) throw err
      logger.warn({ attempt, queueMessageId }, "Scheduled fire queue id collision; retrying")
    }
  }

  throw new Error("Failed to enqueue scheduled_message.fire after 5 attempts")
}

function clampScheduledAt(scheduledAt: Date): Date {
  const now = new Date()
  return scheduledAt.getTime() < now.getTime() ? now : scheduledAt
}
