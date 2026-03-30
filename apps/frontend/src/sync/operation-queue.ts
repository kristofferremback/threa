import { db } from "@/db"
import type { PendingOperation } from "@/db/database"

function getRetryDelay(retryCount: number): number {
  if (retryCount <= 3) return 0
  if (retryCount <= 6) return 5_000
  if (retryCount <= 10) return 30_000
  return 120_000
}

function generateId(): string {
  return `op_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

/** Callback to kick the operation queue processor. Set by the SyncEngine. */
let queueNotify: (() => void) | null = null

/** Register a callback that kicks queue processing (called by SyncEngine on connect). */
export function registerOperationQueueNotify(fn: (() => void) | null): void {
  queueNotify = fn
}

/**
 * Enqueue an offline operation. Writes to IDB and kicks the queue processor.
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
  // Kick the queue so it processes immediately if online
  queueNotify?.()
}

/**
 * Process pending operations from IDB. Called on socket connect/reconnect.
 * Uses Web Locks to prevent cross-tab double-processing.
 */
export async function processOperationQueue(
  messageService: {
    update: (wid: string, mid: string, data: any) => Promise<any>
    delete: (wid: string, mid: string) => Promise<void>
  },
  reactionService: {
    add: (wid: string, mid: string, emoji: string) => Promise<void>
    remove: (wid: string, mid: string, emoji: string) => Promise<void>
  },
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
        await executeOperation(next, messageService, reactionService)
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
  messageService: {
    update: (wid: string, mid: string, data: any) => Promise<any>
    delete: (wid: string, mid: string) => Promise<void>
  },
  reactionService: {
    add: (wid: string, mid: string, emoji: string) => Promise<void>
    remove: (wid: string, mid: string, emoji: string) => Promise<void>
  }
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
  }
}
