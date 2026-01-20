/**
 * Job queue types for the custom queue system.
 *
 * These types are used by QueueManager (queue-manager.ts) and all job workers.
 */

/**
 * Job object passed to handlers.
 */
export interface Job<T = unknown> {
  id: string
  name: string
  data: T
}

// Job type definitions
export const JobQueues = {
  PERSONA_AGENT: "persona.agent",
  NAMING_GENERATE: "naming.generate",
  EMBEDDING_GENERATE: "embedding.generate",
  BOUNDARY_EXTRACT: "boundary.extract",
  MEMO_BATCH_CHECK: "memo.batch-check",
  MEMO_BATCH_PROCESS: "memo.batch-process",
  SIMULATE_RUN: "simulate.run",
  COMMAND_EXECUTE: "command.execute",
} as const

export type JobQueueName = (typeof JobQueues)[keyof typeof JobQueues]

/** Unified persona agent job - handles both companion mode and @mention invocations */
export interface PersonaAgentJobData {
  workspaceId: string
  streamId: string // Where message was sent
  messageId: string // Trigger message
  personaId: string
  triggeredBy: string
  trigger?: "mention" // undefined = companion mode
}

export interface NamingJobData {
  workspaceId: string
  streamId: string
  /** If true, must generate a name (no NOT_ENOUGH_CONTEXT escape). Set when message is from agent. */
  requireName: boolean
}

export interface EmbeddingJobData {
  messageId: string
  workspaceId: string
}

export interface BoundaryExtractionJobData {
  messageId: string
  streamId: string
  workspaceId: string
}

export interface MemoBatchCheckJobData {
  workspaceId: string // Use "system" for system-wide cron job
}

export interface MemoBatchProcessJobData {
  workspaceId: string
  streamId: string
}

export interface SimulationJobData {
  streamId: string
  workspaceId: string
  userId: string
  personas: string[]
  topic: string
  turns: number
}

export interface CommandExecuteJobData {
  commandId: string
  commandName: string
  args: string
  workspaceId: string
  streamId: string
  userId: string
}

// Map queue names to their data types
export interface JobDataMap {
  [JobQueues.PERSONA_AGENT]: PersonaAgentJobData
  [JobQueues.NAMING_GENERATE]: NamingJobData
  [JobQueues.EMBEDDING_GENERATE]: EmbeddingJobData
  [JobQueues.BOUNDARY_EXTRACT]: BoundaryExtractionJobData
  [JobQueues.MEMO_BATCH_CHECK]: MemoBatchCheckJobData
  [JobQueues.MEMO_BATCH_PROCESS]: MemoBatchProcessJobData
  [JobQueues.SIMULATE_RUN]: SimulationJobData
  [JobQueues.COMMAND_EXECUTE]: CommandExecuteJobData
}

/**
 * Handler for a single job. Returns void on success, throws on error.
 */
export type JobHandler<T> = (job: Job<T>) => Promise<void>
