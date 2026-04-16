import type { Pool } from "pg"
import { Visibilities, SavedStatuses, type SavedStatus, type SavedMessageView } from "@threa/types"
import { withTransaction } from "../../db"
import { HttpError } from "../../lib/errors"
// Side-effect import: preloads workspaces → public-api → schemas → messaging
// so that the late-exported `messageMetadataSchema` is bound before this
// module's own imports would trigger a partial messaging-barrel load and a
// TDZ in public-api/schemas.ts. Activity's service relies on the same ordering
// via its own workspaces import.
import "../workspaces"
import { OutboxRepository } from "../../lib/outbox"
import { StreamRepository, StreamMemberRepository } from "../streams"
import { MessageRepository } from "../messaging"
import { SavedMessagesRepository, type SavedMessage } from "./repository"
import { resolveSavedView } from "./view"

interface SavedMessagesServiceDeps {
  pool: Pool
}

export interface SaveParams {
  workspaceId: string
  userId: string
  messageId: string
  remindAt: Date | null
}

export interface UpdateStatusParams {
  workspaceId: string
  userId: string
  savedId: string
  status: SavedStatus
}

export interface UpdateReminderParams {
  workspaceId: string
  userId: string
  savedId: string
  remindAt: Date | null
}

export interface ListParams {
  workspaceId: string
  userId: string
  status: SavedStatus
  limit?: number
  cursor?: string
}

/**
 * Service for saved-message lifecycle. Reminder queue integration lands in
 * phase 3 — for now the service only records `remind_at` on the row; the
 * queue enqueue + tombstone side effects are stubs that will be filled in.
 */
export class SavedMessagesService {
  private readonly pool: Pool

  constructor(deps: SavedMessagesServiceDeps) {
    this.pool = deps.pool
  }

  /**
   * Save a message for the caller. If a row already exists in any status, the
   * upsert resets it to `saved` and overwrites `remind_at`. This matches the
   * product spec: saving a `done`/`archived` entry must bring it back to
   * Saved.
   *
   * Past `remindAt` values are clamped to NOW() server-side so a reminder
   * enqueued in the past fires immediately instead of being rejected.
   */
  async save(params: SaveParams): Promise<SavedMessageView> {
    const clampedRemindAt = clampRemindAt(params.remindAt)

    return withTransaction(this.pool, async (client) => {
      const message = await MessageRepository.findById(client, params.messageId)
      if (!message || message.deletedAt !== null) {
        throw new HttpError("Message not found", { status: 404, code: "MESSAGE_NOT_FOUND" })
      }

      const stream = await StreamRepository.findById(client, message.streamId)
      if (!stream || stream.workspaceId !== params.workspaceId) {
        throw new HttpError("Message not found", { status: 404, code: "MESSAGE_NOT_FOUND" })
      }

      await ensureStreamAccess(client, {
        accessStreamId: stream.rootStreamId ?? stream.id,
        userId: params.userId,
        directStreamVisibility: stream.visibility,
        isThread: stream.rootStreamId !== null,
      })

      const upsert = await SavedMessagesRepository.upsert(client, {
        workspaceId: params.workspaceId,
        userId: params.userId,
        messageId: params.messageId,
        streamId: message.streamId,
        remindAt: clampedRemindAt,
      })

      // Phase 3 will: tombstone `upsert.previousReminderQueueMessageId` and
      // enqueue a fresh queue row when `clampedRemindAt` is set.

      const [view] = await resolveSavedView(client, params.userId, [upsert.saved])

      await OutboxRepository.insert(client, "saved:upserted", {
        workspaceId: params.workspaceId,
        targetUserId: params.userId,
        saved: view!,
      })

      return view!
    })
  }

  async updateStatus(params: UpdateStatusParams): Promise<SavedMessageView> {
    return withTransaction(this.pool, async (client) => {
      const updated = await SavedMessagesRepository.updateStatus(
        client,
        params.workspaceId,
        params.userId,
        params.savedId,
        params.status
      )
      if (!updated) {
        throw new HttpError("Saved item not found", { status: 404, code: "SAVED_NOT_FOUND" })
      }

      // Phase 3: if transitioning away from 'saved' and a queue row is pending,
      // tombstone it so the reminder never fires.

      const [view] = await resolveSavedView(client, params.userId, [updated])

      await OutboxRepository.insert(client, "saved:upserted", {
        workspaceId: params.workspaceId,
        targetUserId: params.userId,
        saved: view!,
      })

      return view!
    })
  }

  async updateReminder(params: UpdateReminderParams): Promise<SavedMessageView> {
    const clampedRemindAt = clampRemindAt(params.remindAt)

    return withTransaction(this.pool, async (client) => {
      const existing = await SavedMessagesRepository.findById(client, params.workspaceId, params.userId, params.savedId)
      if (!existing) {
        throw new HttpError("Saved item not found", { status: 404, code: "SAVED_NOT_FOUND" })
      }
      if (existing.status !== SavedStatuses.SAVED) {
        throw new HttpError("Reminder can only be set on active saved items", {
          status: 409,
          code: "SAVED_NOT_ACTIVE",
        })
      }

      // Phase 3: tombstone existing.reminderQueueMessageId then enqueue a new
      // queue row. For now we just update the row.
      const updated = await SavedMessagesRepository.updateReminder(
        client,
        params.workspaceId,
        params.userId,
        params.savedId,
        { remindAt: clampedRemindAt, queueMessageId: null }
      )
      if (!updated) {
        throw new HttpError("Saved item not found", { status: 404, code: "SAVED_NOT_FOUND" })
      }

      const [view] = await resolveSavedView(client, params.userId, [updated])

      await OutboxRepository.insert(client, "saved:upserted", {
        workspaceId: params.workspaceId,
        targetUserId: params.userId,
        saved: view!,
      })

      return view!
    })
  }

  async delete(params: { workspaceId: string; userId: string; savedId: string }): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const existing = await SavedMessagesRepository.findById(client, params.workspaceId, params.userId, params.savedId)
      if (!existing) {
        throw new HttpError("Saved item not found", { status: 404, code: "SAVED_NOT_FOUND" })
      }

      // Phase 3: tombstone existing.reminderQueueMessageId so a pending
      // reminder never fires on a deleted saved row.

      const deleted = await SavedMessagesRepository.delete(client, params.workspaceId, params.userId, params.savedId)
      if (!deleted) return

      await OutboxRepository.insert(client, "saved:deleted", {
        workspaceId: params.workspaceId,
        targetUserId: params.userId,
        savedId: params.savedId,
        messageId: existing.messageId,
      })
    })
  }

  async list(params: ListParams): Promise<{ saved: SavedMessageView[]; nextCursor: string | null }> {
    const limit = params.limit ?? 50
    const rows = await SavedMessagesRepository.listByUser(this.pool, params.workspaceId, params.userId, {
      status: params.status,
      limit: limit + 1,
      cursor: params.cursor,
    })

    const hasMore = rows.length > limit
    const pageRows = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? (pageRows[pageRows.length - 1]?.id ?? null) : null

    const saved = await resolveSavedView(this.pool, params.userId, pageRows)
    return { saved, nextCursor }
  }

  async findByMessageId(params: {
    workspaceId: string
    userId: string
    messageId: string
  }): Promise<SavedMessage | null> {
    return SavedMessagesRepository.findByMessageId(this.pool, params.workspaceId, params.userId, params.messageId)
  }
}

function clampRemindAt(remindAt: Date | null): Date | null {
  if (!remindAt) return null
  const now = new Date()
  return remindAt.getTime() < now.getTime() ? now : remindAt
}

async function ensureStreamAccess(
  client: import("pg").PoolClient,
  params: {
    accessStreamId: string
    userId: string
    /** Visibility of the message's direct stream. Used only when `isThread` is false. */
    directStreamVisibility: string
    isThread: boolean
  }
): Promise<void> {
  // Threads inherit access from their root stream; the thread stream's own
  // visibility is not authoritative. Non-thread messages use the direct
  // stream's visibility.
  let visibility = params.directStreamVisibility
  if (params.isThread) {
    const root = await StreamRepository.findById(client, params.accessStreamId)
    if (!root) {
      throw new HttpError("Message not found", { status: 404, code: "MESSAGE_NOT_FOUND" })
    }
    visibility = root.visibility
  }

  if (visibility === Visibilities.PUBLIC) return

  const isMember = await StreamMemberRepository.isMember(client, params.accessStreamId, params.userId)
  if (!isMember) {
    throw new HttpError("Forbidden", { status: 403, code: "FORBIDDEN" })
  }
}
