import { PgBoss } from "pg-boss"
import { logger } from "./logger"

let boss: PgBoss | null = null

export async function initJobQueue(connectionString: string): Promise<PgBoss> {
  if (boss) {
    return boss
  }

  boss = new PgBoss({
    connectionString,
    retentionDays: 7,
    archiveCompletedAfterSeconds: 3600,
    deleteAfterDays: 14,
    monitorStateIntervalSeconds: 30,
  })

  boss.on("error", (err) => {
    logger.error({ err }, "pg-boss error")
  })

  boss.on("monitor-states", (states) => {
    logger.debug({ states }, "pg-boss monitor states")
  })

  await boss.start()
  logger.info("pg-boss job queue started")

  // Pre-create queues so workers don't error when polling empty queues
  const aiQueues: AIJobType[] = ["ai.embed", "ai.classify", "ai.respond", "ai.extract"]
  const memoryQueues: MemoryJobType[] = ["memory.enrich", "memory.create-memo", "memory.evolve"]
  const allQueues = [...aiQueues, ...memoryQueues]
  for (const queue of allQueues) {
    await boss.createQueue(queue)
  }
  logger.info({ queues: allQueues }, "Job queues created")

  return boss
}

export function getJobQueue(): PgBoss {
  if (!boss) {
    throw new Error("Job queue not initialized. Call initJobQueue first.")
  }
  return boss
}

export async function stopJobQueue(): Promise<void> {
  if (boss) {
    // Stop with a short timeout - don't wait forever for workers to finish
    await boss.stop({ graceful: true, timeout: 5000 })
    boss = null
    logger.info("pg-boss job queue stopped")
  }
}

// Job type definitions
export type AIJobType = "ai.embed" | "ai.classify" | "ai.respond" | "ai.extract"
export type MemoryJobType = "memory.enrich" | "memory.create-memo" | "memory.evolve"
export type JobType = AIJobType | MemoryJobType

// Priority levels (lower = higher priority)
export const JobPriority = {
  URGENT: 1, // @ariadne responses - user waiting
  HIGH: 3, // User-triggered actions (extraction)
  NORMAL: 5, // Embeddings
  LOW: 7, // Classification
  BACKGROUND: 9, // Batch operations
} as const

export interface EmbedJobData {
  workspaceId: string
  textMessageId: string
  content: string
  eventId?: string
}

export interface ClassifyJobData {
  workspaceId: string
  streamId?: string
  eventId?: string
  textMessageId?: string
  content: string
  contentType: "thread" | "message"
  reactionCount?: number
}

export type AriadneMode = "retrieval" | "thinking_partner"

export interface RespondJobData {
  workspaceId: string
  streamId: string
  eventId: string
  mentionedBy: string
  question: string
  mode?: AriadneMode
}

export interface ExtractJobData {
  workspaceId: string
  sourceStreamId?: string
  sourceEventId: string
  extractedBy: string
  contextMessages: Array<{
    id: string
    actorName: string
    content: string
    createdAt: string
  }>
}

// Memory system job data types
export interface EnrichJobData {
  workspaceId: string
  textMessageId: string
  eventId: string
  signals: EnrichmentSignals
}

export interface EnrichmentSignals {
  reactions?: number
  replies?: number
  retrieved?: boolean
  helpful?: boolean
}

export interface CreateMemoJobData {
  workspaceId: string
  anchorEventIds: string[]
  streamId: string
  source: "user" | "system" | "ariadne"
  createdBy?: string
  summary?: string
  sessionId?: string
}

export interface EvolveJobData {
  workspaceId: string
}

// Helper to enqueue jobs with workspace AI check
export async function enqueueAIJob<T extends Record<string, unknown>>(
  jobType: AIJobType,
  data: T & { workspaceId: string },
  options: {
    priority?: number
    retryLimit?: number
    startAfter?: number // seconds
  } = {},
): Promise<string | null> {
  const queue = getJobQueue()

  return await queue.send(
    jobType,
    data,
    {
      priority: options.priority ?? JobPriority.NORMAL,
      retryLimit: options.retryLimit ?? 3,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 3600,
      ...(options.startAfter && { startAfter: options.startAfter }),
    },
  )
}

