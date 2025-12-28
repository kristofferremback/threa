import type { PersonaInvokeJobData, JobHandler } from "../lib/job-queue"
import type { MentionInvokeAgentInput, MentionInvokeResult } from "../agents/mention-invoke-agent"
import { logger } from "../lib/logger"

/** Interface for any agent that can handle mention invoke jobs */
export interface MentionInvokeAgentLike {
  run(input: MentionInvokeAgentInput): Promise<MentionInvokeResult>
}

export interface MentionInvokeWorkerDeps {
  agent: MentionInvokeAgentLike
  serverId: string
}

/**
 * Create the mention invoke job handler for pg-boss.
 *
 * This is a thin wrapper that extracts job data and delegates to the mention invoke agent.
 * All business logic lives in the agent module for reusability and testability.
 */
export function createMentionInvokeWorker(deps: MentionInvokeWorkerDeps): JobHandler<PersonaInvokeJobData> {
  const { agent, serverId } = deps

  return async (job) => {
    const { workspaceId, streamId, messageId, personaId, targetStreamId } = job.data

    logger.info({ jobId: job.id, streamId, messageId, personaId, targetStreamId }, "Processing mention invoke job")

    const result = await agent.run({
      workspaceId,
      streamId,
      messageId,
      personaId,
      targetStreamId,
      serverId,
    })

    if (result.status === "failed") {
      // Re-throw to trigger pg-boss retry
      throw new Error(`Mention invoke agent failed for session ${result.sessionId}`)
    }

    logger.info({ jobId: job.id, ...result }, "Mention invoke job completed")
  }
}
