import type { Pool } from "pg"
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres"
import type { CompanionJobData, JobHandler } from "../lib/job-queue"
import type { AuthorType } from "../lib/constants"
import type { ProviderRegistry } from "../lib/ai"
import { runCompanionAgent } from "../agents/companion-agent"
import { logger } from "../lib/logger"

export interface CompanionWorkerDeps {
  pool: Pool
  modelRegistry: ProviderRegistry
  checkpointer: PostgresSaver
  serverId: string
  createMessage: (params: {
    workspaceId: string
    streamId: string
    authorId: string
    authorType: AuthorType
    content: string
  }) => Promise<{ id: string }>
}

/**
 * Create the companion job handler for pg-boss.
 *
 * This is a thin wrapper that extracts job data and delegates to the companion agent.
 * All business logic lives in the agent module for reusability and testability.
 */
export function createCompanionWorker(
  deps: CompanionWorkerDeps,
): JobHandler<CompanionJobData> {
  const { pool, modelRegistry, checkpointer, serverId, createMessage } = deps

  return async (job) => {
    const { streamId, messageId } = job.data

    logger.info(
      { jobId: job.id, streamId, messageId },
      "Processing companion job",
    )

    const result = await runCompanionAgent(
      { pool, modelRegistry, checkpointer, createMessage },
      { streamId, messageId, serverId },
    )

    if (result.status === "failed") {
      // Re-throw to trigger pg-boss retry
      throw new Error(`Companion agent failed for session ${result.sessionId}`)
    }

    logger.info(
      { jobId: job.id, ...result },
      "Companion job completed",
    )
  }
}
