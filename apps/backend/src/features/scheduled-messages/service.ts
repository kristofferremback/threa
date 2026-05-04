import type { Pool, PoolClient } from "pg"
import {
  AuthorTypes,
  ScheduledMessageStatuses,
  SCHEDULED_MESSAGE_SYNC_LOCK_THRESHOLD_SECONDS,
  type ScheduledMessageView,
  type JSONContent,
} from "@threa/types"
import { withTransaction } from "../../db"
import { HttpError, isUniqueViolation } from "../../lib/errors"
// Side-effect import: matches the load-order workaround used by other features
// that pull in messaging via the public-api schema chain (saved-messages does
// the same — see service.ts there for the TDZ explanation).
import "../workspaces"
import { OutboxRepository } from "../../lib/outbox"
import { StreamRepository, StreamMemberRepository, type Stream } from "../streams"
import { Visibilities } from "@threa/types"
import { MessageRepository } from "../messaging"
import { EventService } from "../messaging"
import { scheduledMessageId, scheduledMessageQueueId, userSessionId, workerId } from "../../lib/id"
import { JobQueues, QueueRepository, enqueueQueuedJob, type ScheduledMessageSendJobData } from "../../lib/queue"
import { logger } from "../../lib/logger"
import { ScheduledMessagesRepository, type ScheduledMessage } from "./repository"
import { toScheduledMessageView } from "./view"

interface ScheduledMessagesServiceDeps {
  pool: Pool
  eventService: EventService
}

export interface ScheduleParams {
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

export interface UpdateScheduledParams {
  workspaceId: string
  userId: string
  id: string
  lockToken: string
  contentJson?: JSONContent
  contentMarkdown?: string
  attachmentIds?: string[]
  metadata?: Record<string, string> | null
  scheduledFor?: Date
}

export interface ListScheduledParams {
  workspaceId: string
  userId: string
  status: "pending" | "sent" | "failed" | "cancelled"
  streamId?: string
  limit?: number
  cursor?: string
}

export interface ClaimResult {
  scheduled: ScheduledMessageView
  lockToken: string
  lockExpiresAt: Date
  /** Server hint — true when scheduled_for is within the sync threshold. */
  sync: boolean
}

const EDITOR_LOCK_TTL_SECONDS = 60
const WORKER_LOCK_TTL_SECONDS = 10
const MIN_FUTURE_OFFSET_SECONDS = 5

/** Past-time grace window for the worker. Beyond this we mark the row failed. */
const WORKER_MAX_LOCK_RETRIES = 6

/**
 * Service for the scheduled-message lifecycle: schedule / update / claim /
 * release / send-now / cancel / fire (worker entry).
 */
export class ScheduledMessagesService {
  private readonly pool: Pool
  private readonly eventService: EventService

  constructor(deps: ScheduledMessagesServiceDeps) {
    this.pool = deps.pool
    this.eventService = deps.eventService
  }

  /**
   * Create a scheduled message and enqueue its fire job. Idempotent on
   * `clientMessageId` — a duplicate POST returns the existing row instead of
   * creating a second one (mirrors message create semantics).
   *
   * `scheduledFor` is clamped forward to `MIN_FUTURE_OFFSET_SECONDS` from now;
   * a "schedule for the past" request fires almost immediately, which is how
   * offline-replayed mutations recover gracefully without forcing the user to
   * pick a new time.
   */
  async schedule(params: ScheduleParams): Promise<ScheduledMessageView> {
    const clamped = clampToFuture(params.scheduledFor)

    return withTransaction(this.pool, async (client) => {
      if (params.clientMessageId) {
        const existing = await ScheduledMessagesRepository.findByClientMessageId(
          client,
          params.workspaceId,
          params.userId,
          params.clientMessageId
        )
        if (existing) return toScheduledMessageView(existing)
      }

      await this.ensureStreamWriteAccess(client, params.workspaceId, params.userId, params.streamId)

      if (params.parentMessageId) {
        const parent = await MessageRepository.findById(client, params.parentMessageId)
        if (!parent || parent.deletedAt !== null) {
          throw new HttpError("Parent message not found", {
            status: 404,
            code: "SCHEDULED_MESSAGE_PARENT_UNAVAILABLE",
          })
        }
        // Workspace-scope check (INV-8): MessageRepository.findById is keyed
        // by the message PK alone, so we must verify the parent belongs to
        // the caller's workspace via its stream. Without this, a caller could
        // attach a foreign workspace's message id and the row would be
        // accepted (and silently leak workspace boundaries at fire time).
        const parentStream = await StreamRepository.findById(client, parent.streamId)
        if (!parentStream || parentStream.workspaceId !== params.workspaceId) {
          throw new HttpError("Parent message not found", {
            status: 404,
            code: "SCHEDULED_MESSAGE_PARENT_UNAVAILABLE",
          })
        }
      }

      const id = scheduledMessageId()
      let row: ScheduledMessage
      try {
        row = await ScheduledMessagesRepository.insert(client, {
          id,
          workspaceId: params.workspaceId,
          userId: params.userId,
          streamId: params.streamId,
          parentMessageId: params.parentMessageId,
          contentJson: params.contentJson,
          contentMarkdown: params.contentMarkdown,
          attachmentIds: params.attachmentIds,
          metadata: params.metadata,
          scheduledFor: clamped,
          clientMessageId: params.clientMessageId,
        })
      } catch (err) {
        // Concurrent duplicate insert with the same client_message_id — refetch
        // the winner and return it. Same shape the message-create path uses.
        if (params.clientMessageId && isUniqueViolation(err, "idx_scheduled_messages_client_id")) {
          const existing = await ScheduledMessagesRepository.findByClientMessageId(
            client,
            params.workspaceId,
            params.userId,
            params.clientMessageId
          )
          if (existing) return toScheduledMessageView(existing)
        }
        throw err
      }

      const queueId = await this.enqueueSendJob(client, row)
      const updated = (await ScheduledMessagesRepository.findById(client, params.workspaceId, params.userId, id)) ?? {
        ...row,
        queueMessageId: queueId,
      }

      const view = toScheduledMessageView(updated)
      await this.publishUpsert(client, view, params.userId)

      return view
    })
  }

  async list(params: ListScheduledParams): Promise<{ scheduled: ScheduledMessageView[]; nextCursor: string | null }> {
    const limit = params.limit ?? 50
    const rows = await ScheduledMessagesRepository.listByUser(this.pool, params.workspaceId, params.userId, {
      status: params.status,
      streamId: params.streamId,
      limit: limit + 1,
      cursor: params.cursor,
    })

    const hasMore = rows.length > limit
    const pageRows = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? (pageRows[pageRows.length - 1]?.id ?? null) : null

    return { scheduled: pageRows.map(toScheduledMessageView), nextCursor }
  }

  async getById(params: { workspaceId: string; userId: string; id: string }): Promise<ScheduledMessageView | null> {
    const row = await ScheduledMessagesRepository.findById(this.pool, params.workspaceId, params.userId, params.id)
    return row ? toScheduledMessageView(row) : null
  }

  /**
   * Acquire the editor lock. The CAS in the repository takes the row out of
   * worker rotation atomically — if it succeeds, the worker can't fire while
   * we hold the lock. If the row is already `sending`/`sent`/`cancelled`/
   * `failed`, the CAS fails and we surface a 409 with a code the client uses
   * to fall back to "live message" navigation.
   *
   * The lock-token is the user session id — distinct from the user id so two
   * tabs can't accidentally extend each other's locks.
   */
  async claim(params: { workspaceId: string; userId: string; id: string }): Promise<ClaimResult> {
    return withTransaction(this.pool, async (client) => {
      await this.assertPendingOrThrow(client, params)

      const ownerId = `usr:${params.userId}:${userSessionId()}`
      const claimed = await ScheduledMessagesRepository.tryAcquireLock(client, {
        workspaceId: params.workspaceId,
        id: params.id,
        ownerId,
        ttlSeconds: EDITOR_LOCK_TTL_SECONDS,
        setStatus: null,
      })

      if (!claimed) {
        throw new HttpError("Lock held by another editor", {
          status: 409,
          code: "SCHEDULED_MESSAGE_LOCK_HELD",
        })
      }

      const view = toScheduledMessageView(claimed)
      const sync = claimed.scheduledFor.getTime() - Date.now() < SCHEDULED_MESSAGE_SYNC_LOCK_THRESHOLD_SECONDS * 1000

      // Lock-state changes broadcast back so the user's other tabs/devices
      // can reflect "currently editing" state (Journey 12).
      await this.publishUpsert(client, view, params.userId)

      return {
        scheduled: view,
        lockToken: ownerId,
        lockExpiresAt: claimed.editLockExpiresAt!,
        sync,
      }
    })
  }

  async heartbeat(params: {
    workspaceId: string
    userId: string
    id: string
    lockToken: string
  }): Promise<{ lockExpiresAt: Date }> {
    const row = await ScheduledMessagesRepository.heartbeatLock(this.pool, {
      workspaceId: params.workspaceId,
      id: params.id,
      ownerId: params.lockToken,
      ttlSeconds: EDITOR_LOCK_TTL_SECONDS,
    })
    if (!row || !row.editLockExpiresAt) {
      throw new HttpError("Lock expired or released", {
        status: 409,
        code: "SCHEDULED_MESSAGE_LOCK_EXPIRED",
      })
    }
    return { lockExpiresAt: row.editLockExpiresAt }
  }

  async release(params: { workspaceId: string; userId: string; id: string; lockToken: string }): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const row = await ScheduledMessagesRepository.releaseLock(client, {
        workspaceId: params.workspaceId,
        id: params.id,
        ownerId: params.lockToken,
      })
      if (!row) return

      await this.publishUpsert(client, toScheduledMessageView(row), params.userId)
    })
  }

  /**
   * Update a pending scheduled message. The lock token is required and the
   * repo's `update()` re-asserts the lock owner under the same UPDATE so a
   * stale token never lands a write.
   *
   * If `scheduledFor` shifts, we cancel the prior queue row and enqueue a
   * fresh one inside the same transaction.
   *
   * If the new `scheduledFor` is in the past, this method calls `EventService.
   * createMessage` atomically and transitions to `sent` — the "Save = Send"
   * semantics from the past-time edit UX. The lock guarantees the worker
   * isn't doing the same thing concurrently.
   */
  async update(params: UpdateScheduledParams): Promise<ScheduledMessageView> {
    return withTransaction(this.pool, async (client) => {
      const existing = await this.assertPendingOrThrow(client, params)
      if (existing.editLockOwnerId !== params.lockToken || (existing.editLockExpiresAt?.getTime() ?? 0) <= Date.now()) {
        throw new HttpError("Lock expired or not held by caller", {
          status: 409,
          code: "SCHEDULED_MESSAGE_LOCK_EXPIRED",
        })
      }

      const updated = await ScheduledMessagesRepository.update(client, {
        workspaceId: params.workspaceId,
        userId: params.userId,
        id: params.id,
        lockOwnerId: params.lockToken,
        contentJson: params.contentJson,
        contentMarkdown: params.contentMarkdown,
        attachmentIds: params.attachmentIds,
        metadata: params.metadata,
        scheduledFor: params.scheduledFor,
      })
      if (!updated) {
        throw new HttpError("Lock expired or not held by caller", {
          status: 409,
          code: "SCHEDULED_MESSAGE_LOCK_EXPIRED",
        })
      }

      const scheduledForChanged =
        params.scheduledFor !== undefined && params.scheduledFor.getTime() !== existing.scheduledFor.getTime()

      const finalRow =
        (await ScheduledMessagesRepository.findById(client, params.workspaceId, params.userId, params.id)) ?? updated

      // Past-time save = atomic send (per the past-time editing UX). The
      // editor still holds the lock at this point, so no worker tick can race
      // us. We flip status to `sending` via the same CAS shape the worker
      // uses, reusing the editor's lockToken as the CAS owner so the
      // (`edit_lock_owner_id = ${ownerId}`) clause matches without a
      // release-then-reclaim. We skip the reschedule enqueue (no point
      // queueing a job we're about to short-circuit) and tombstone the
      // existing queue row so a stale worker tick can't fire after commit.
      if (finalRow.scheduledFor.getTime() <= Date.now()) {
        const flipped = await ScheduledMessagesRepository.tryAcquireLock(client, {
          workspaceId: params.workspaceId,
          id: params.id,
          ownerId: params.lockToken,
          ttlSeconds: WORKER_LOCK_TTL_SECONDS,
          setStatus: ScheduledMessageStatuses.SENDING,
        })
        if (!flipped) {
          throw new HttpError("Scheduled message no longer pending", {
            status: 409,
            code: "SCHEDULED_MESSAGE_NOT_PENDING",
          })
        }
        if (existing.queueMessageId) {
          await QueueRepository.cancelById(client, existing.queueMessageId)
        }
        return await this.finalizeSendInTx(client, flipped)
      }

      // Reschedule: cancel old queue row and enqueue a fresh one in the same
      // tx. Worker's status guard catches any tick that lost the cancel race.
      if (scheduledForChanged) {
        if (existing.queueMessageId) {
          await QueueRepository.cancelById(client, existing.queueMessageId)
        }
        await this.enqueueSendJob(client, finalRow)
      }

      const view = toScheduledMessageView(finalRow)
      await this.publishUpsert(client, view, params.userId)

      return view
    })
  }

  async sendNow(params: { workspaceId: string; userId: string; id: string }): Promise<ScheduledMessageView> {
    return withTransaction(this.pool, async (client) => {
      const existing = await this.assertPendingOrThrow(client, params)

      // Take the worker-style lock atomically (status flip → sending).
      const ownerId = `worker:send-now:${workerId()}`
      const claimed = await ScheduledMessagesRepository.tryAcquireLock(client, {
        workspaceId: params.workspaceId,
        id: params.id,
        ownerId,
        ttlSeconds: WORKER_LOCK_TTL_SECONDS,
        setStatus: ScheduledMessageStatuses.SENDING,
      })
      if (!claimed) {
        throw new HttpError("Lock held by another actor", {
          status: 409,
          code: "SCHEDULED_MESSAGE_LOCK_HELD",
        })
      }

      if (existing.queueMessageId) {
        await QueueRepository.cancelById(client, existing.queueMessageId)
      }

      return await this.finalizeSendInTx(client, claimed)
    })
  }

  async cancel(params: { workspaceId: string; userId: string; id: string }): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const existing = await this.assertPendingOrThrow(client, params, {
        notPendingMessage: (status) => `Cannot cancel ${status} scheduled message`,
      })

      const cancelled = await ScheduledMessagesRepository.cancel(client, params.workspaceId, params.userId, params.id)
      if (!cancelled) {
        // Race: someone else (worker) won between findById and cancel.
        throw new HttpError("Already sending or sent", {
          status: 409,
          code: "SCHEDULED_MESSAGE_ALREADY_SENDING",
        })
      }

      if (existing.queueMessageId) {
        await QueueRepository.cancelById(client, existing.queueMessageId)
      }

      await OutboxRepository.insert(client, "scheduled_message:cancelled", {
        workspaceId: params.workspaceId,
        targetUserId: params.userId,
        scheduledId: params.id,
      })
    })
  }

  /**
   * Worker entry. Re-reads scoped to (workspaceId, id) per INV-8, then attempts
   * the CAS. Returns `{ fired }` so the worker can log + decide whether to
   * reschedule on lock contention. The lock is held for `WORKER_LOCK_TTL_SECONDS`
   * which is plenty for the EventService send + outbox writes.
   */
  async fire(params: {
    workspaceId: string
    scheduledMessageId: string
  }): Promise<{ fired: boolean; reschedule: boolean }> {
    const ownerId = `worker:send:${workerId()}`

    return withTransaction(this.pool, async (client) => {
      const row = await ScheduledMessagesRepository.findByIdScoped(
        client,
        params.workspaceId,
        params.scheduledMessageId
      )
      if (!row) {
        logger.debug({ ...params }, "scheduled_message fire skipped — row missing")
        return { fired: false, reschedule: false }
      }
      if (row.status !== ScheduledMessageStatuses.PENDING) {
        logger.debug({ ...params, status: row.status }, "scheduled_message fire skipped — not pending")
        return { fired: false, reschedule: false }
      }
      if (row.scheduledFor.getTime() > Date.now()) {
        // Stale leased queue row that survived a reschedule cancel — the
        // editor pushed scheduled_for forward and a fresh queue row is
        // already enqueued for the new time. Drop this tick silently; the
        // new queue row will fire when due. Marking the row failed here
        // would tombstone a perfectly valid future-scheduled message.
        logger.debug(
          { ...params, scheduledFor: row.scheduledFor.toISOString() },
          "scheduled_message fire skipped — rescheduled to future"
        )
        return { fired: false, reschedule: false }
      }

      const claimed = await ScheduledMessagesRepository.tryAcquireLock(client, {
        workspaceId: params.workspaceId,
        id: params.scheduledMessageId,
        ownerId,
        ttlSeconds: WORKER_LOCK_TTL_SECONDS,
        setStatus: ScheduledMessageStatuses.SENDING,
        // The pre-read above checks scheduled_for, but a concurrent reschedule
        // could push the row forward between that read and this CAS. Putting
        // the due-time guard inside the CAS itself closes the gap so a
        // late-arriving reschedule still shields the row from early delivery.
        requireDueNow: true,
      })

      if (!claimed) {
        // Editor holds the lock (or a same-tx reschedule landed in the gap).
        // Bounded retry — if we exceed the budget the user has been editing
        // for too long; mark failed so they see the row turn red instead of
        // silently slipping further.
        const retries = await ScheduledMessagesRepository.incrementRetryCount(
          client,
          params.workspaceId,
          params.scheduledMessageId
        )
        if (retries > WORKER_MAX_LOCK_RETRIES) {
          await ScheduledMessagesRepository.markFailed(client, {
            workspaceId: params.workspaceId,
            id: params.scheduledMessageId,
            reason: "lock_contention_timeout",
          })
          const view = await this.refetchView(client, row)
          if (view) await this.publishUpsert(client, view, row.userId)
          return { fired: false, reschedule: false }
        }
        return { fired: false, reschedule: true }
      }

      try {
        await this.finalizeSendInTx(client, claimed)
        return { fired: true, reschedule: false }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "unknown_error"
        logger.warn({ ...params, error: reason }, "scheduled_message fire failed")
        await ScheduledMessagesRepository.markFailed(client, {
          workspaceId: params.workspaceId,
          id: params.scheduledMessageId,
          reason,
        })
        const view = await this.refetchView(client, row)
        if (view) await this.publishUpsert(client, view, row.userId)
        return { fired: false, reschedule: false }
      }
    })
  }

  /**
   * Shared finalizer used by:
   *   - the worker fire path (after CAS to `sending`),
   *   - send-now (after CAS to `sending`),
   *   - PATCH-when-past-time (after CAS to `sending` via the lock).
   *
   * Caller is expected to have already taken the lock and flipped status to
   * `sending`. We assert that here as a safety net (idempotent — if status is
   * already `sent` we no-op).
   */
  private async finalizeSendInTx(client: PoolClient, row: ScheduledMessage): Promise<ScheduledMessageView> {
    if (row.status === ScheduledMessageStatuses.SENT) {
      return toScheduledMessageView(row)
    }
    if (row.status !== ScheduledMessageStatuses.SENDING) {
      throw new Error(`finalizeSendInTx called with status=${row.status}`)
    }

    const message = await this.eventService.createMessage({
      workspaceId: row.workspaceId,
      streamId: row.streamId,
      authorId: row.userId,
      authorType: AuthorTypes.USER,
      contentJson: row.contentJson,
      contentMarkdown: row.contentMarkdown,
      attachmentIds: row.attachmentIds.length > 0 ? row.attachmentIds : undefined,
      metadata: row.metadata ?? undefined,
      // Use the scheduled message id as the idempotency key. If the same
      // scheduled row gets re-fired after an interrupted finalize (process
      // restart between createMessage and markSent), the second attempt
      // returns the existing message instead of duplicating.
      clientMessageId: `scheduled:${row.id}`,
    })

    const sent = await ScheduledMessagesRepository.markSent(client, {
      workspaceId: row.workspaceId,
      id: row.id,
      sentMessageId: message.id,
    })
    const finalRow = sent ?? { ...row, status: ScheduledMessageStatuses.SENT, sentMessageId: message.id }
    const view = toScheduledMessageView(finalRow)

    await OutboxRepository.insert(client, "scheduled_message:sent", {
      workspaceId: row.workspaceId,
      targetUserId: row.userId,
      scheduledId: row.id,
      sentMessageId: message.id,
      streamId: row.streamId,
      scheduled: view,
    })

    return view
  }

  private async refetchView(client: PoolClient, row: ScheduledMessage): Promise<ScheduledMessageView | null> {
    const fresh = await ScheduledMessagesRepository.findByIdScoped(client, row.workspaceId, row.id)
    return fresh ? toScheduledMessageView(fresh) : null
  }

  /**
   * Find a scheduled row scoped to (workspace, user) and assert it's still
   * pending — the precondition for claim / update / sendNow / cancel. Throws
   * 404 when the row is missing, 409 with a status-aware code otherwise.
   * Use `notPendingMessage` to override the user-visible text per call site
   * (e.g. cancel uses "Cannot cancel sending scheduled message").
   */
  private async assertPendingOrThrow(
    client: PoolClient,
    params: { workspaceId: string; userId: string; id: string },
    options?: { notPendingMessage?: (status: string) => string }
  ): Promise<ScheduledMessage> {
    const existing = await ScheduledMessagesRepository.findById(client, params.workspaceId, params.userId, params.id)
    if (!existing) {
      throw new HttpError("Scheduled message not found", {
        status: 404,
        code: "SCHEDULED_MESSAGE_NOT_FOUND",
      })
    }
    if (existing.status !== ScheduledMessageStatuses.PENDING) {
      const buildMessage = options?.notPendingMessage ?? ((status: string) => `Scheduled message already ${status}`)
      throw new HttpError(buildMessage(existing.status), {
        status: 409,
        code:
          existing.status === ScheduledMessageStatuses.SENDING
            ? "SCHEDULED_MESSAGE_ALREADY_SENDING"
            : "SCHEDULED_MESSAGE_NOT_PENDING",
      })
    }
    return existing
  }

  /** Write a `scheduled_message:upserted` outbox row scoped to the row's owner. */
  private publishUpsert(client: PoolClient, view: ScheduledMessageView, userId: string): Promise<unknown> {
    return OutboxRepository.insert(client, "scheduled_message:upserted", {
      workspaceId: view.workspaceId,
      targetUserId: userId,
      scheduled: view,
    })
  }

  /**
   * Insert a `scheduled_message.send` queue row with `process_after =
   * scheduledFor` and pin the queue id back onto the scheduled row. The
   * insert + retry-on-PK-collision loop is shared with saved-messages via
   * `enqueueQueuedJob`; the queue id is then written back here since that
   * step is table-specific.
   */
  private async enqueueSendJob(client: PoolClient, row: ScheduledMessage): Promise<string> {
    const payload: ScheduledMessageSendJobData = {
      workspaceId: row.workspaceId,
      userId: row.userId,
      scheduledMessageId: row.id,
    }
    const queueId = await enqueueQueuedJob(client, {
      queueName: JobQueues.SCHEDULED_MESSAGE_SEND,
      workspaceId: row.workspaceId,
      payload,
      processAfter: row.scheduledFor,
      generateId: scheduledMessageQueueId,
    })
    await ScheduledMessagesRepository.setQueueMessageId(client, row.workspaceId, row.id, queueId)
    return queueId
  }

  /**
   * Stream-write authorization. Mirrors the saved-messages stream-access
   * helper but for write intent: the user must be a member of the stream
   * (or the stream's root for thread sends), and the workspace must match.
   * Public streams allow any workspace user to write — same as live message
   * create.
   */
  private async ensureStreamWriteAccess(
    client: PoolClient,
    workspaceId: string,
    userId: string,
    streamIdParam: string
  ): Promise<Stream> {
    const stream = await StreamRepository.findById(client, streamIdParam)
    if (!stream || stream.workspaceId !== workspaceId) {
      throw new HttpError("Stream not found", { status: 404, code: "STREAM_NOT_FOUND" })
    }
    if (stream.archivedAt) {
      throw new HttpError("Cannot schedule messages to an archived stream", {
        status: 403,
        code: "STREAM_ARCHIVED",
      })
    }

    const accessStreamId = stream.rootStreamId ?? stream.id
    let accessStream: Stream | null = stream
    if (stream.rootStreamId) {
      accessStream = await StreamRepository.findById(client, accessStreamId)
      if (!accessStream) {
        throw new HttpError("Parent stream not found", { status: 404, code: "STREAM_NOT_FOUND" })
      }
    }

    if (accessStream.visibility === Visibilities.PUBLIC) return stream

    const isMember = await StreamMemberRepository.isMember(client, accessStreamId, userId)
    if (!isMember) {
      throw new HttpError("Not a member of this stream", { status: 403, code: "FORBIDDEN" })
    }

    return stream
  }
}

function clampToFuture(date: Date): Date {
  const minMs = Date.now() + MIN_FUTURE_OFFSET_SECONDS * 1000
  return date.getTime() < minMs ? new Date(minMs) : date
}
