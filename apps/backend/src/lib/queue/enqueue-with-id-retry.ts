import type { PoolClient } from "pg"
import { isUniqueViolation } from "../errors"
import { logger } from "../logger"
import { QueueRepository } from "./repository"
import type { JobDataMap, JobQueueName } from "./job-queue"

interface EnqueueQueuedJobParams<Q extends JobQueueName> {
  queueName: Q
  workspaceId: string
  payload: JobDataMap[Q]
  processAfter: Date
  /** Generates a fresh queue id on each attempt — should yield a new ULID each call. */
  generateId: () => string
  /** Optional retry budget for cosmically-improbable PK collisions. Default 5. */
  maxRetries?: number
}

const DEFAULT_MAX_RETRIES = 5

/**
 * Insert a `queue_messages` row with retry-on-PK-collision. Both the saved-
 * message reminder enqueue and the scheduled-message send enqueue need this
 * shape — generate a ULID, insert, regenerate-and-retry on the rare PK
 * collision, give up after a small budget so a runaway generator doesn't
 * spin forever.
 *
 * Returns the queue id that was successfully inserted. Caller is responsible
 * for writing it back onto the parent domain row (table-specific) — this
 * helper stays scoped to the queue insert.
 */
export async function enqueueQueuedJob<Q extends JobQueueName>(
  client: PoolClient,
  params: EnqueueQueuedJobParams<Q>
): Promise<string> {
  const max = params.maxRetries ?? DEFAULT_MAX_RETRIES
  const now = new Date()
  let queueId = params.generateId()

  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      await QueueRepository.insert(client, {
        id: queueId,
        queueName: params.queueName,
        workspaceId: params.workspaceId,
        payload: params.payload,
        processAfter: params.processAfter,
        insertedAt: now,
      })
      return queueId
    } catch (err) {
      if (!isUniqueViolation(err, "queue_messages_pkey")) throw err
      if (attempt >= max) {
        logger.error({ attempt, queueId, queueName: params.queueName }, "Gave up after repeated queue id collisions")
        throw err
      }
      logger.warn({ attempt, queueId, queueName: params.queueName }, "Queue id collision; retrying")
      queueId = params.generateId()
    }
  }

  // Unreachable — the loop either returns the id or throws.
  throw new Error(`Failed to insert ${params.queueName} queue row after ${max} retries`)
}
