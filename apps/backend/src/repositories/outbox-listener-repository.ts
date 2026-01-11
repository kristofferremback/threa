import { Pool, PoolClient } from "pg"
import { sql, withTransaction } from "../db"
import { OutboxRepository, OutboxEvent } from "./outbox-repository"
import {
  type HandlerEffect,
  type JobEffect,
  type EmitEffect,
  type EmitToUserEffect,
  categorizeEffects,
} from "../lib/handler-effects"
import { type JobQueueManager, type JobQueueName, type JobDataMap } from "../lib/job-queue"

export interface ListenerState {
  listenerId: string
  lastProcessedId: bigint
  lastProcessedAt: Date | null
  retryCount: number
  retryAfter: Date | null
  lastError: string | null
}

interface ListenerRow {
  listener_id: string
  last_processed_id: string
  last_processed_at: Date | null
  retry_count: number
  retry_after: Date | null
  last_error: string | null
}

function mapRowToState(row: ListenerRow): ListenerState {
  return {
    listenerId: row.listener_id,
    lastProcessedId: BigInt(row.last_processed_id),
    lastProcessedAt: row.last_processed_at,
    retryCount: row.retry_count,
    retryAfter: row.retry_after,
    lastError: row.last_error,
  }
}

export const OutboxListenerRepository = {
  /**
   * Claims exclusive lock on a listener's cursor row.
   * This must be called within a transaction - the lock is held until COMMIT/ROLLBACK.
   * Returns null if listener doesn't exist or is already locked by another transaction.
   *
   * Uses SKIP LOCKED to prevent transaction build-up when multiple processes
   * compete for the same listener. Callers should retry via polling rather than blocking.
   */
  async claimListener(client: PoolClient, listenerId: string): Promise<ListenerState | null> {
    const result = await client.query<ListenerRow>(sql`
      SELECT
        listener_id,
        last_processed_id,
        last_processed_at,
        retry_count,
        retry_after,
        last_error
      FROM outbox_listeners
      WHERE listener_id = ${listenerId}
      FOR UPDATE SKIP LOCKED
    `)

    if (result.rows.length === 0) {
      return null
    }

    return mapRowToState(result.rows[0])
  },

  /**
   * Updates the cursor after successfully processing events.
   * Resets retry state on success.
   *
   * IMPORTANT: Must be called within a transaction where claimListener() was called first.
   */
  async updateCursor(client: PoolClient, listenerId: string, newCursor: bigint): Promise<void> {
    await client.query(sql`
      UPDATE outbox_listeners
      SET
        last_processed_id = ${newCursor.toString()},
        last_processed_at = NOW(),
        retry_count = 0,
        retry_after = NULL,
        last_error = NULL,
        updated_at = NOW()
      WHERE listener_id = ${listenerId}
    `)
  },

  /**
   * Checks if a listener is ready to process (not in retry backoff).
   */
  async isReadyToProcess(client: PoolClient, listenerId: string): Promise<boolean> {
    const result = await client.query<{ retry_after: Date | null }>(sql`
      SELECT retry_after
      FROM outbox_listeners
      WHERE listener_id = ${listenerId}
    `)

    if (result.rows.length === 0) {
      return false
    }

    const retryAfter = result.rows[0].retry_after
    if (retryAfter === null) {
      return true
    }

    return new Date() >= retryAfter
  },

  /**
   * Ensures a listener exists, creating it if necessary.
   * Used during startup to register new listeners.
   *
   * WARNING: Default startFromId=0 will cause new listeners to process ALL historical events.
   * Use ensureListenerFromLatest() to start from the current position instead.
   */
  async ensureListener(client: PoolClient, listenerId: string, startFromId: bigint = 0n): Promise<void> {
    await client.query(sql`
      INSERT INTO outbox_listeners (listener_id, last_processed_id)
      VALUES (${listenerId}, ${startFromId.toString()})
      ON CONFLICT (listener_id) DO NOTHING
    `)
  },

  /**
   * Ensures a listener exists, starting from the latest outbox event.
   * New listeners will only process events created after registration.
   * Use this for listeners that don't need to backfill historical events.
   */
  async ensureListenerFromLatest(client: PoolClient, listenerId: string): Promise<void> {
    await client.query(sql`
      INSERT INTO outbox_listeners (listener_id, last_processed_id)
      SELECT ${listenerId}, COALESCE(MAX(id), 0)
      FROM outbox
      ON CONFLICT (listener_id) DO NOTHING
    `)
  },
}

export const CLAIM_STATUS = {
  CLAIMED: "claimed",
  NOT_READY: "not_ready",
  NO_EVENTS: "no_events",
} as const

export type ClaimAndFetchResult =
  | { status: typeof CLAIM_STATUS.CLAIMED; events: OutboxEvent[]; lastEventId: bigint }
  | { status: typeof CLAIM_STATUS.NOT_READY }
  | { status: typeof CLAIM_STATUS.NO_EVENTS }

/**
 * Claims events for processing and immediately releases the connection.
 *
 * This is a two-phase approach designed to prevent connection pool exhaustion:
 * 1. Short transaction: claim lock, fetch events, advance cursor, COMMIT (release connection)
 * 2. Process events outside the transaction (no connection held)
 *
 * The cursor is advanced BEFORE processing (optimistic). This means:
 * - If processing fails, the event is "lost" from this listener's perspective
 * - Critical processing should dispatch to pg-boss for durability
 * - This matches the semantic that outbox is for fan-out/dispatch, not guaranteed delivery
 *
 * Why this design?
 * - Previous design held connection during handler execution
 * - Handlers could call withClient() for nested DB queries
 * - 9 listeners × (1 withClaim + N withClient) = pool exhaustion
 * - By releasing connection before handlers run, nested queries don't compete
 *
 * @example
 * ```ts
 * const result = await claimAndFetchEvents(pool, "broadcast", 100)
 * if (result.status === "claimed") {
 *   for (const event of result.events) {
 *     await handleEvent(event) // No connection held!
 *   }
 * }
 * ```
 */
export async function claimAndFetchEvents(
  pool: Pool,
  listenerId: string,
  batchSize: number = 100
): Promise<ClaimAndFetchResult> {
  return withTransaction(pool, async (client) => {
    // Check if we're in retry backoff
    const isReady = await OutboxListenerRepository.isReadyToProcess(client, listenerId)
    if (!isReady) {
      return { status: CLAIM_STATUS.NOT_READY }
    }

    // Claim exclusive lock on our cursor row
    // Returns null if already locked by another transaction (SKIP LOCKED) - this is expected
    const state = await OutboxListenerRepository.claimListener(client, listenerId)
    if (!state) {
      return { status: CLAIM_STATUS.NOT_READY }
    }

    // Fetch events after our cursor
    const events = await OutboxRepository.fetchAfterId(client, state.lastProcessedId, batchSize)
    if (events.length === 0) {
      return { status: CLAIM_STATUS.NO_EVENTS }
    }

    // Advance cursor BEFORE processing (optimistic claim)
    // This releases the "claim" on these events - they're ours now
    const lastEventId = events[events.length - 1].id
    await OutboxListenerRepository.updateCursor(client, listenerId, lastEventId)

    // Transaction commits here, releasing the connection
    return { status: CLAIM_STATUS.CLAIMED, events, lastEventId }
  })
}

/**
 * Handler signature for pure handlers that return effects.
 *
 * The handler receives:
 * - event: The outbox event to process
 * - client: A PoolClient for database queries within the transaction
 *
 * Returns an array of effects to execute. The handler MUST NOT execute
 * effects itself - it should only return what should happen.
 */
export type PureHandler = (event: OutboxEvent, client: PoolClient) => Promise<HandlerEffect[]>

export const PROCESS_STATUS = {
  PROCESSED: "processed",
  NOT_READY: "not_ready",
  NO_EVENTS: "no_events",
} as const

export type ClaimAndProcessResult =
  | {
      status: typeof PROCESS_STATUS.PROCESSED
      processedCount: number
      ephemeralEffects: (EmitEffect | EmitToUserEffect)[]
    }
  | { status: typeof PROCESS_STATUS.NOT_READY }
  | { status: typeof PROCESS_STATUS.NO_EVENTS }

/**
 * Claims events and processes them with guaranteed delivery for durable effects.
 *
 * This function implements a transactional guarantee pattern:
 * 1. Claim lock on listener cursor (SELECT FOR UPDATE)
 * 2. Fetch events after cursor
 * 3. Run handler for each event (handler returns effects, can query DB)
 * 4. Execute durable effects (pg-boss jobs) within transaction
 * 5. Update cursor
 * 6. COMMIT - at this point, all pg-boss jobs are committed atomically with cursor
 * 7. Return ephemeral effects for caller to execute outside transaction
 *
 * This solves the durability problem:
 * - If crash before COMMIT: cursor not advanced, events will be reprocessed
 * - If crash after COMMIT: pg-boss jobs are persisted, ephemeral effects are lost (acceptable)
 *
 * @example
 * ```ts
 * const result = await claimAndProcessEvents(pool, jobQueue, "companion", 100, async (event, client) => {
 *   if (event.eventType !== "message:created") return []
 *
 *   const stream = await StreamRepository.findById(client, event.payload.streamId)
 *   if (!stream || stream.companionMode !== "on") return []
 *
 *   return [job(JobQueues.PERSONA_AGENT, { ... })]
 * })
 *
 * // Execute ephemeral effects outside transaction
 * if (result.status === "processed") {
 *   for (const effect of result.ephemeralEffects) {
 *     if (effect.type === "emit") {
 *       io.to(effect.room).emit(effect.event, effect.data)
 *     }
 *   }
 * }
 * ```
 */
export async function claimAndProcessEvents(
  pool: Pool,
  jobQueue: JobQueueManager,
  listenerId: string,
  batchSize: number,
  handler: PureHandler
): Promise<ClaimAndProcessResult> {
  // Accumulate ephemeral effects to return after commit
  let ephemeralEffects: (EmitEffect | EmitToUserEffect)[] = []
  let processedCount = 0

  const transactionResult = await withTransaction(pool, async (client) => {
    // Check if we're in retry backoff
    const isReady = await OutboxListenerRepository.isReadyToProcess(client, listenerId)
    if (!isReady) {
      return { status: PROCESS_STATUS.NOT_READY } as const
    }

    // Claim exclusive lock on our cursor row
    const state = await OutboxListenerRepository.claimListener(client, listenerId)
    if (!state) {
      return { status: PROCESS_STATUS.NOT_READY } as const
    }

    // Fetch events after our cursor
    const events = await OutboxRepository.fetchAfterId(client, state.lastProcessedId, batchSize)
    if (events.length === 0) {
      return { status: PROCESS_STATUS.NO_EVENTS } as const
    }

    // Process each event and collect effects
    const allEffects: HandlerEffect[] = []
    for (const event of events) {
      const effects = await handler(event, client)
      allEffects.push(...effects)
    }

    // Categorize effects
    const { durable, ephemeral } = categorizeEffects(allEffects)

    // Execute durable effects (pg-boss jobs) within this transaction
    for (const jobEffect of durable) {
      await jobQueue.sendWithClient(client, jobEffect.queue as JobQueueName, jobEffect.data as JobDataMap[JobQueueName])
    }

    // Update cursor - events are now claimed
    const lastEventId = events[events.length - 1].id
    await OutboxListenerRepository.updateCursor(client, listenerId, lastEventId)

    // Store ephemeral effects for return after commit
    ephemeralEffects = ephemeral
    processedCount = events.length

    // Signal success - transaction will commit
    return { status: PROCESS_STATUS.PROCESSED } as const
  })

  // If transaction succeeded, return the ephemeral effects
  if (transactionResult.status === PROCESS_STATUS.PROCESSED) {
    return {
      status: PROCESS_STATUS.PROCESSED,
      processedCount,
      ephemeralEffects,
    }
  }

  return transactionResult
}
