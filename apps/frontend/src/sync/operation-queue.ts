import { db } from "@/db"
import type { PendingOperation } from "@/db/database"
import type { ScheduleMessageInput, ScheduledMessageView } from "@threa/types"
import { persistScheduledRows, replaceLocalScheduledRow } from "@/hooks/use-scheduled"

function getRetryDelay(retryCount: number): number {
  if (retryCount <= 3) return 0
  if (retryCount <= 6) return 5_000
  if (retryCount <= 10) return 30_000
  return 120_000
}

function generateId(): string {
  return `op_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

interface MessageServiceLike {
  update: (wid: string, mid: string, data: any) => Promise<any>
  delete: (wid: string, mid: string) => Promise<void>
}

interface ReactionServiceLike {
  add: (wid: string, mid: string, emoji: string) => Promise<void>
  remove: (wid: string, mid: string, emoji: string) => Promise<void>
}

interface ScheduledServiceLike {
  create: (workspaceId: string, input: ScheduleMessageInput) => Promise<ScheduledMessageView>
  delete: (workspaceId: string, id: string) => Promise<void>
  sendNow: (workspaceId: string, id: string) => Promise<ScheduledMessageView>
}

/**
 * Enqueue an offline operation. Writes to IDB and returns immediately.
 * The operation will be processed when the SyncEngine kicks the queue
 * (on connect/reconnect) or when explicitly kicked via the SyncEngine.
 */
export async function enqueueOperation(
  workspaceId: string,
  type: PendingOperation["type"],
  payload: Record<string, unknown>
): Promise<void> {
  await db.pendingOperations.add({
    id: generateId(),
    workspaceId,
    type,
    payload,
    createdAt: Date.now(),
    retryCount: 0,
  })
}

/**
 * Process pending operations from IDB. Called on socket connect/reconnect.
 * Uses Web Locks to prevent cross-tab double-processing.
 */
export async function processOperationQueue(
  messageService: MessageServiceLike,
  reactionService: ReactionServiceLike,
  scheduledService: ScheduledServiceLike | undefined,
  isOnline: () => boolean
): Promise<void> {
  const processor = async () => {
    const now = Date.now()
    const skipped = new Set<string>()

    while (true) {
      if (!isOnline()) break

      const candidates = await db.pendingOperations.orderBy("createdAt").toArray()
      const next = candidates.find((op) => !skipped.has(op.id) && (op.retryAfter ?? 0) <= now)
      if (!next) break

      try {
        await executeOperation(next, messageService, reactionService, scheduledService)
        await db.pendingOperations.delete(next.id)
      } catch {
        const retryCount = next.retryCount + 1
        await db.pendingOperations.update(next.id, {
          retryCount,
          retryAfter: Date.now() + getRetryDelay(retryCount),
        })
        skipped.add(next.id)
      }
    }
  }

  if (navigator.locks) {
    await navigator.locks.request("threa-operation-queue", { ifAvailable: true }, async (lock) => {
      if (!lock) return
      await processor()
    })
  } else {
    await processor()
  }
}

async function executeOperation(
  op: PendingOperation,
  messageService: MessageServiceLike,
  reactionService: ReactionServiceLike,
  scheduledService: ScheduledServiceLike | undefined
): Promise<void> {
  const { workspaceId, type, payload } = op

  switch (type) {
    case "edit_message":
      await messageService.update(workspaceId, payload.messageId as string, {
        contentJson: payload.contentJson as import("@threa/types").JSONContent,
      })
      break

    case "delete_message":
      await messageService.delete(workspaceId, payload.messageId as string)
      break

    case "add_reaction":
      await reactionService.add(workspaceId, payload.messageId as string, payload.emoji as string)
      break

    case "remove_reaction":
      await reactionService.remove(workspaceId, payload.messageId as string, payload.emoji as string)
      break

    case "schedule_message": {
      if (!scheduledService) throw new Error("scheduledService is required to replay schedule_message ops")
      const placeholderId = payload.placeholderId as string
      const input = payload.input as ScheduleMessageInput
      const created = await scheduledService.create(workspaceId, input)
      // Swap the local placeholder for the server row in one transaction so
      // the live Dexie query never observes a frame with neither row present.
      await replaceLocalScheduledRow(placeholderId, created)
      break
    }

    case "cancel_scheduled_message": {
      if (!scheduledService) throw new Error("scheduledService is required to replay cancel_scheduled_message ops")
      await scheduledService.delete(workspaceId, payload.id as string)
      break
    }

    case "send_scheduled_now": {
      if (!scheduledService) throw new Error("scheduledService is required to replay send_scheduled_now ops")
      const sent = await scheduledService.sendNow(workspaceId, payload.id as string)
      await persistScheduledRows([sent])
      break
    }

    case "update_scheduled_message":
      // Updates carry an `expectedUpdatedAt` snapshot — once that timestamp
      // is stale (the user finished a session and another save landed), the
      // server will return STALE_VERSION which is not a transient failure.
      // We deliberately do NOT enqueue updates today; the editor surfaces
      // the conflict synchronously and the user re-saves with the latest
      // version. This case is reserved for a future opt-in.
      throw new Error("update_scheduled_message replay is not implemented")
  }
}
