import type { CompanionJobData, JobHandler } from "../lib/job-queue"
import type { StubCompanionAgent } from "../agents/companion-agent.stub"
import { logger } from "../lib/logger"

export interface StubCompanionWorkerDeps {
  agent: StubCompanionAgent
  serverId: string
}

/**
 * Stub version of the companion worker for testing.
 *
 * This is a thin wrapper that delegates to the stub companion agent.
 * The stub agent creates sessions and posts canned responses without calling real AI.
 */
export function createStubCompanionWorker(
  deps: StubCompanionWorkerDeps,
): JobHandler<CompanionJobData> {
  const { agent, serverId } = deps

  return async (job) => {
    const { streamId, messageId } = job.data

    logger.info(
      { jobId: job.id, streamId, messageId },
      "Processing companion job (STUB)",
    )

    const result = await agent.run({ streamId, messageId, serverId })

    if (result.status === "failed") {
      throw new Error(`Stub companion agent failed for session ${result.sessionId}`)
    }

    logger.info(
      { jobId: job.id, ...result },
      "Companion job completed (STUB)",
    )
  }
}
