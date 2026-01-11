import type { PoolClient } from "pg"
import type { JobQueueName, JobDataMap } from "./job-queue"

/**
 * Effect types for outbox handlers.
 *
 * Handlers return effects instead of executing them directly. This enables:
 * - Durable effects (pg-boss jobs) to be executed within the claim transaction
 * - Ephemeral effects (Socket.io) to be executed after commit
 * - Guaranteed at-least-once delivery for critical work
 */

/** Dispatch a job to pg-boss queue (durable, within transaction) */
export interface JobEffect<T extends JobQueueName = JobQueueName> {
  type: "job"
  queue: T
  data: JobDataMap[T]
}

/** Emit event to Socket.io room (ephemeral, after commit) */
export interface EmitEffect {
  type: "emit"
  room: string
  event: string
  data: unknown
}

/** Emit event to specific user's sockets (ephemeral, after commit) */
export interface EmitToUserEffect {
  type: "emitToUser"
  userId: string
  event: string
  data: unknown
}

export type HandlerEffect = JobEffect | EmitEffect | EmitToUserEffect

/** Helper to create a job effect */
export function job<T extends JobQueueName>(queue: T, data: JobDataMap[T]): JobEffect<T> {
  return { type: "job", queue, data }
}

/** Helper to create an emit effect */
export function emit(room: string, event: string, data: unknown): EmitEffect {
  return { type: "emit", room, event, data }
}

/** Helper to create an emit-to-user effect */
export function emitToUser(userId: string, event: string, data: unknown): EmitToUserEffect {
  return { type: "emitToUser", userId, event, data }
}

/** Categorize effects by durability */
export function categorizeEffects(effects: HandlerEffect[]): {
  durable: JobEffect[]
  ephemeral: (EmitEffect | EmitToUserEffect)[]
} {
  const durable: JobEffect[] = []
  const ephemeral: (EmitEffect | EmitToUserEffect)[] = []

  for (const effect of effects) {
    if (effect.type === "job") {
      durable.push(effect)
    } else {
      ephemeral.push(effect)
    }
  }

  return { durable, ephemeral }
}
