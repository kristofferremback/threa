import type { CompanionJobData, JobHandler } from "../lib/job-queue"
import type { CompanionAgentInput, CompanionAgentResult } from "../agents/companion-agent"
import { logger } from "../lib/logger"

/** Interface for any agent that can handle companion jobs */
export interface CompanionAgentLike {
  run(input: CompanionAgentInput): Promise<CompanionAgentResult>
}

export interface CompanionWorkerDeps {
  agent: CompanionAgentLike
  serverId: string
}

/**
 * Create the companion job handler for pg-boss.
 *
 * This is a thin wrapper that extracts job data and delegates to the companion agent.
 * All business logic lives in the agent module for reusability and testability.
 */
export function createCompanionWorker(deps: CompanionWorkerDeps): JobHandler<CompanionJobData> {
  const { agent, serverId } = deps

  return async (job) => {
    const { streamId, messageId } = job.data

    logger.info({ jobId: job.id, streamId, messageId }, "Processing companion job")

    const result = await agent.run({ streamId, messageId, serverId })

    if (result.status === "failed") {
      // Re-throw to trigger pg-boss retry
      throw new Error(`Companion agent failed for session ${result.sessionId}`)
    }

    logger.info({ jobId: job.id, ...result }, "Companion job completed")
  }
}
