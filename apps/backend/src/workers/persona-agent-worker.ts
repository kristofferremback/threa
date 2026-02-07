import type { Pool } from "pg"
import type { PersonaAgentJobData, JobHandler } from "../lib/job-queue"
import { JobQueues } from "../lib/job-queue"
import { AgentTriggers } from "@threa/types"
import type { QueueManager } from "../lib/queue-manager"
import type { PersonaAgentInput, PersonaAgentResult } from "../agents/persona-agent"
import { StreamEventRepository } from "../repositories/stream-event-repository"
import { logger } from "../lib/logger"

/** Interface for any agent that can handle persona agent jobs */
export interface PersonaAgentLike {
  run(input: PersonaAgentInput): Promise<PersonaAgentResult>
}

export interface PersonaAgentWorkerDeps {
  agent: PersonaAgentLike
  serverId: string
  /** Pool for checking unseen messages after job completion */
  pool: Pool
  /** Job queue for dispatching follow-up jobs */
  jobQueue: QueueManager
}

/**
 * Create the persona agent job handler for queue system.
 *
 * This is a thin wrapper that extracts job data and delegates to the persona agent.
 * All business logic lives in the agent module for reusability and testability.
 *
 * IMPORTANT: After job completion, checks for unseen messages and dispatches
 * a follow-up job if needed. This handles the race condition where messages
 * arrive while a session is running and the listener skips dispatching jobs
 * for them (since a session is already active).
 */
export function createPersonaAgentWorker(deps: PersonaAgentWorkerDeps): JobHandler<PersonaAgentJobData> {
  const { agent, serverId, pool, jobQueue } = deps

  return async (job) => {
    const { workspaceId, streamId, messageId, personaId, trigger } = job.data

    logger.info({ jobId: job.id, streamId, messageId, personaId, trigger }, "Processing persona agent job")

    const result = await agent.run({
      workspaceId,
      streamId,
      messageId,
      personaId,
      serverId,
      trigger,
    })

    if (result.status === "failed") {
      // Re-throw to trigger queue system retry
      throw new Error(`Persona agent failed for session ${result.sessionId}`)
    }

    logger.info({ jobId: job.id, ...result }, "Persona agent job completed")

    // Check for unseen messages that arrived while the session was running.
    // The companion listener skips dispatching jobs for messages when a session
    // is already active (RUNNING/PENDING), so we need to catch up here.
    // Skip for mentions — they work in threads with a different sequence space
    // than the channel, and new mentions get their own jobs via mention-invoke.
    if (result.status === "completed" && result.lastSeenSequence !== undefined && trigger !== AgentTriggers.MENTION) {
      await checkForUnseenMessages({
        pool,
        jobQueue,
        workspaceId,
        streamId: result.streamId ?? streamId,
        personaId: result.personaId ?? personaId,
        lastSeenSequence: result.lastSeenSequence,
        trigger,
        previousJobId: job.id,
      })
    }
  }
}

/**
 * Check if there are USER messages that arrived after lastSeenSequence and dispatch
 * a follow-up job if needed.
 *
 * IMPORTANT: We only check for USER messages, not all messages. Otherwise the
 * agent's own responses would trigger follow-up jobs in an infinite loop.
 */
async function checkForUnseenMessages(params: {
  pool: Pool
  jobQueue: QueueManager
  workspaceId: string
  streamId: string
  personaId: string
  lastSeenSequence: bigint
  trigger?: typeof AgentTriggers.MENTION
  previousJobId: string
}): Promise<void> {
  const { pool, jobQueue, workspaceId, streamId, personaId, lastSeenSequence, trigger, previousJobId } = params

  // Only check for USER messages - ignore persona responses to avoid infinite loops (single query, INV-30)
  const latestUserMessageSequence = await StreamEventRepository.getLatestMemberMessageSequence(pool, streamId)

  // No user messages at all, or no new user messages since we last checked
  if (!latestUserMessageSequence || latestUserMessageSequence <= lastSeenSequence) {
    return
  }

  logger.info(
    {
      streamId,
      lastSeenSequence: lastSeenSequence.toString(),
      latestUserMessageSequence: latestUserMessageSequence.toString(),
      previousJobId,
    },
    "Found unseen user messages after session completion, dispatching follow-up job"
  )

  // Dispatch a follow-up job to process the unseen messages
  // We use a synthetic messageId since we're catching up on multiple messages
  await jobQueue.send(JobQueues.PERSONA_AGENT, {
    workspaceId,
    streamId,
    messageId: `followup_${previousJobId}`,
    personaId,
    triggeredBy: "system", // Follow-up jobs are system-triggered
    trigger,
  })
}
