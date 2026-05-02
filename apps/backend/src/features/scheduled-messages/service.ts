import type { Pool, PoolClient } from "pg"
import { serializeToMarkdown } from "@threa/prosemirror"
import {
  ScheduledMessageStatuses,
  AuthorTypes,
  type JSONContent,
  type ScheduledMessageView,
  type ScheduledMessageStatus,
} from "@threa/types"
import { isUniqueViolation } from "@threa/backend-common"
import { withTransaction } from "../../db"
import { HttpError } from "../../lib/errors"
import { logger } from "../../lib/logger"
import { scheduledMessageQueueId } from "../../lib/id"
import { JobQueues, QueueRepository, type ScheduledMessageFireJobData } from "../../lib/queue"
import { OutboxRepository } from "../../lib/outbox"
import type { EventService } from "../messaging"
import type { StreamService } from "../streams"
import { ScheduledMessagesRepository, type ScheduledMessage } from "./repository"
import { resolveScheduledView } from "./view"

interface ScheduledMessagesServiceDeps {
  pool: Pool
  eventService: EventService
  streamService: StreamService
}

export interface CreateScheduledMessageParams {
  workspaceId: string
  userId: string
  streamId: string
  contentJson: JSONContent
  contentMarkdown?: string
  attachmentIds?: string[]
  scheduledAt: Date
  clientMessageId?: string
}

export interface UpdateScheduledMessageParams {
  workspaceId: string
  userId: string
  scheduledId: string
  contentJson?: JSONContent
  contentMarkdown?: string
  attachmentIds?: string[]
  scheduledAt?: Date
  status?: typeof ScheduledMessageStatuses.SCHEDULED | typeof ScheduledMessageStatuses.PAUSED
  expectedVersion?: number
}

const MAX_QUEUE_ID_RETRIES = 5
const FIRING_LEASE_MS = 5 * 60_000
const ACTIVE_STATUSES = new Set<ScheduledMessageStatus>([
  ScheduledMessageStatuses.SCHEDULED,
  ScheduledMessageStatuses.PAUSED,
  ScheduledMessageStatuses.EDITING,
  ScheduledMessageStatuses.FAILED,
])

export class ScheduledMessagesService {
  private readonly pool: Pool
  private readonly eventService: EventService
  private readonly streamService: StreamService

  constructor(deps: ScheduledMessagesServiceDeps) {
    this.pool = deps.pool
    this.eventService = deps.eventService
    this.streamService = deps.streamService
  }

  async create(params: CreateScheduledMessageParams): Promise<ScheduledMessageView> {
    const scheduledAt = clampToNow(params.scheduledAt)
    const contentMarkdown = serializeToMarkdown(params.contentJson)

    return withTransaction(this.pool, async (client) => {
      const stream = await this.streamService.resolveWritableMessageStream({
        workspaceId: params.workspaceId,
        userId: params.userId,
        target: { streamId: params.streamId },
      })

      const created = await ScheduledMessagesRepository.create(client, {
        workspaceId: params.workspaceId,
        userId: params.userId,
        streamId: stream.id,
        scheduledAt,
        contentJson: params.contentJson,
        contentMarkdown,
        attachmentIds: params.attachmentIds ?? [],
        clientMessageId: params.clientMessageId ?? `scheduled:${scheduledMessageQueueId()}`,
      })

      const queued = await enqueueScheduled(client, created)
      const [view] = await resolveScheduledView(client, [queued])
      await publishUpsert(client, view!)
      return view!
    })
  }

  async list(params: { workspaceId: string; userId: string }): Promise<ScheduledMessageView[]> {
    const rows = await ScheduledMessagesRepository.listByUser(this.pool, params.workspaceId, params.userId)
    return resolveScheduledView(this.pool, rows)
  }

  async update(params: UpdateScheduledMessageParams): Promise<ScheduledMessageView> {
    if (params.contentMarkdown !== undefined && params.contentJson === undefined) {
      throw new HttpError("contentJson is required when changing scheduled message content", {
        status: 400,
        code: "SCHEDULED_CONTENT_JSON_REQUIRED",
      })
    }

    return withTransaction(this.pool, async (client) => {
      const existing = await this.getMutable(client, params.workspaceId, params.userId, params.scheduledId)
      if (params.expectedVersion !== undefined && existing.version !== params.expectedVersion) {
        throw new HttpError("Scheduled message changed", { status: 409, code: "SCHEDULED_VERSION_CONFLICT" })
      }

      if (existing.queueMessageId) await QueueRepository.cancelById(client, existing.queueMessageId)

      const nextStatus =
        params.status ??
        (existing.status === ScheduledMessageStatuses.EDITING
          ? releaseStatusForEditing(existing.editPreviousStatus)
          : undefined)
      const updated = await ScheduledMessagesRepository.update(
        client,
        params.workspaceId,
        params.userId,
        params.scheduledId,
        {
          contentJson: params.contentJson,
          contentMarkdown: params.contentJson ? serializeToMarkdown(params.contentJson) : undefined,
          attachmentIds: params.attachmentIds,
          scheduledAt: params.scheduledAt ? clampToNow(params.scheduledAt) : undefined,
          status: nextStatus,
          queueMessageId: null,
          expectedVersion: existing.version,
        }
      )
      if (!updated) throw conflictFor(existing)

      const finalRow =
        updated.status === ScheduledMessageStatuses.SCHEDULED ? await enqueueScheduled(client, updated) : updated
      const [view] = await resolveScheduledView(client, [finalRow])
      await publishUpsert(client, view!)
      return view!
    })
  }

  async pause(params: { workspaceId: string; userId: string; scheduledId: string; expectedVersion?: number }) {
    return this.update({ ...params, status: ScheduledMessageStatuses.PAUSED })
  }

  async resume(params: { workspaceId: string; userId: string; scheduledId: string; expectedVersion?: number }) {
    return this.update({ ...params, status: ScheduledMessageStatuses.SCHEDULED })
  }

  async sendNow(params: { workspaceId: string; userId: string; scheduledId: string; expectedVersion?: number }) {
    return this.update({
      ...params,
      status: ScheduledMessageStatuses.SCHEDULED,
      scheduledAt: new Date(),
    })
  }

  async editLock(params: { workspaceId: string; userId: string; scheduledId: string; expectedVersion?: number }) {
    return withTransaction(this.pool, async (client) => {
      const existing = await this.getMutable(client, params.workspaceId, params.userId, params.scheduledId)
      if (params.expectedVersion !== undefined && existing.version !== params.expectedVersion) {
        throw new HttpError("Scheduled message changed", { status: 409, code: "SCHEDULED_VERSION_CONFLICT" })
      }
      if (existing.queueMessageId) await QueueRepository.cancelById(client, existing.queueMessageId)
      const locked = await ScheduledMessagesRepository.markEditing(
        client,
        params.workspaceId,
        params.userId,
        params.scheduledId,
        existing.version
      )
      if (!locked) throw conflictFor(existing)
      const [view] = await resolveScheduledView(client, [locked])
      await publishUpsert(client, view!)
      return view!
    })
  }

  async delete(params: {
    workspaceId: string
    userId: string
    scheduledId: string
    expectedVersion?: number
  }): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const existing = await this.getMutable(client, params.workspaceId, params.userId, params.scheduledId)
      if (params.expectedVersion !== undefined && existing.version !== params.expectedVersion) {
        throw new HttpError("Scheduled message changed", { status: 409, code: "SCHEDULED_VERSION_CONFLICT" })
      }
      if (existing.queueMessageId) await QueueRepository.cancelById(client, existing.queueMessageId)
      const deleted = await ScheduledMessagesRepository.markDeleted(
        client,
        params.workspaceId,
        params.userId,
        params.scheduledId,
        existing.version
      )
      if (!deleted) throw conflictFor(existing)
      await OutboxRepository.insert(client, "scheduled_message:deleted", {
        workspaceId: params.workspaceId,
        targetUserId: params.userId,
        scheduledId: params.scheduledId,
      })
    })
  }

  async fireDue(params: { scheduledId: string }): Promise<{ fired: boolean }> {
    const now = new Date()
    const staleBefore = new Date(now.getTime() - FIRING_LEASE_MS)
    const claimed = await withTransaction(this.pool, async (client) =>
      ScheduledMessagesRepository.claimDueForFire(client, params.scheduledId, now, staleBefore)
    )
    if (!claimed) return { fired: false }

    try {
      const message = await this.eventService.createMessage({
        workspaceId: claimed.workspaceId,
        streamId: claimed.streamId,
        authorId: claimed.userId,
        authorType: AuthorTypes.USER,
        contentJson: claimed.contentJson,
        contentMarkdown: claimed.contentMarkdown,
        attachmentIds: claimed.attachmentIds.length > 0 ? claimed.attachmentIds : undefined,
        clientMessageId: claimed.clientMessageId,
      })

      await withTransaction(this.pool, async (client) => {
        const sent = await ScheduledMessagesRepository.markSent(client, claimed.id, message.id)
        if (!sent) return
        const [view] = await resolveScheduledView(client, [sent])
        await publishUpsert(client, view!)
      })
      return { fired: true }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown scheduled message failure"
      logger.error({ err: error, scheduledId: claimed.id }, "Scheduled message fire failed")
      await withTransaction(this.pool, async (client) => {
        const failed = await ScheduledMessagesRepository.markFailed(client, claimed.id, reason)
        if (!failed) return
        const [view] = await resolveScheduledView(client, [failed])
        await publishUpsert(client, view!)
      })
      throw error
    }
  }

  private async getMutable(
    client: PoolClient,
    workspaceId: string,
    userId: string,
    scheduledId: string
  ): Promise<ScheduledMessage> {
    const row = await ScheduledMessagesRepository.findById(client, workspaceId, userId, scheduledId)
    if (!row) throw new HttpError("Scheduled message not found", { status: 404, code: "SCHEDULED_NOT_FOUND" })
    if (!ACTIVE_STATUSES.has(row.status)) throw conflictFor(row)
    return row
  }
}

async function enqueueScheduled(client: PoolClient, row: ScheduledMessage): Promise<ScheduledMessage> {
  const payload: ScheduledMessageFireJobData = {
    workspaceId: row.workspaceId,
    scheduledMessageId: row.id,
  }
  let queueMessageId = scheduledMessageQueueId()
  for (let attempt = 1; ; attempt++) {
    try {
      await QueueRepository.insert(client, {
        id: queueMessageId,
        queueName: JobQueues.SCHEDULED_MESSAGE_FIRE,
        workspaceId: row.workspaceId,
        payload,
        processAfter: row.scheduledAt,
        insertedAt: new Date(),
      })
      break
    } catch (err) {
      if (!isUniqueViolation(err, "queue_messages_pkey")) throw err
      if (attempt >= MAX_QUEUE_ID_RETRIES) throw err
      queueMessageId = scheduledMessageQueueId()
    }
  }
  return ScheduledMessagesRepository.setQueueMessageId(client, row, queueMessageId)
}

async function publishUpsert(client: PoolClient, scheduled: ScheduledMessageView): Promise<void> {
  await OutboxRepository.insert(client, "scheduled_message:upserted", {
    workspaceId: scheduled.workspaceId,
    targetUserId: scheduled.userId,
    scheduled,
  })
}

function clampToNow(date: Date): Date {
  const now = new Date()
  return date.getTime() < now.getTime() ? now : date
}

function releaseStatusForEditing(
  previous: ScheduledMessageStatus | null
): typeof ScheduledMessageStatuses.SCHEDULED | typeof ScheduledMessageStatuses.PAUSED {
  return previous === ScheduledMessageStatuses.PAUSED
    ? ScheduledMessageStatuses.PAUSED
    : ScheduledMessageStatuses.SCHEDULED
}

function conflictFor(row: ScheduledMessage): HttpError {
  if (row.status === ScheduledMessageStatuses.SENT) {
    return new HttpError("Scheduled message was already sent", {
      status: 409,
      code: "SCHEDULED_ALREADY_SENT",
    })
  }
  return new HttpError("Scheduled message can no longer be changed", {
    status: 409,
    code: "SCHEDULED_NOT_MUTABLE",
  })
}
