import type { Pool } from "pg"
import type { CompanionJobData, JobHandler } from "../lib/job-queue"
import { runStubCompanionAgent } from "../agents/companion-agent.stub"
import { logger } from "../lib/logger"

export interface StubCompanionWorkerDeps {
  pool: Pool
  serverId: string
  createMessage: (params: {
    workspaceId: string
    streamId: string
    authorId: string
    authorType: "user" | "persona"
    content: string
  }) => Promise<{ id: string }>
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
  const { pool, serverId, createMessage } = deps

  return async (job) => {
    const { streamId, messageId } = job.data

    logger.info(
      { jobId: job.id, streamId, messageId },
      "Processing companion job (STUB)",
    )

    const result = await runStubCompanionAgent(
      { pool, createMessage },
      { streamId, messageId, serverId },
    )

    if (result.status === "failed") {
      throw new Error(`Stub companion agent failed for session ${result.sessionId}`)
    }

    logger.info(
      { jobId: job.id, ...result },
      "Companion job completed (STUB)",
    )
  }
}
