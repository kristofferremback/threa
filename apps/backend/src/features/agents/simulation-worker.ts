import type { SimulationJobData, JobHandler } from "../../lib/queue"
import type { SimulationAgentInput, SimulationAgentResult } from "./simulation-agent"
import { logger } from "../../lib/logger"

export interface SimulationAgentLike {
  run(input: SimulationAgentInput): Promise<SimulationAgentResult>
}

export interface SimulationWorkerDeps {
  agent: SimulationAgentLike
}

/**
 * Create the simulation job handler for queue system.
 *
 * Thin wrapper that extracts job data and delegates to the simulation agent.
 */
export function createSimulationWorker(deps: SimulationWorkerDeps): JobHandler<SimulationJobData> {
  const { agent } = deps

  return async (job) => {
    const { streamId, workspaceId, memberId, personas, topic, turns } = job.data

    logger.info({ jobId: job.id, streamId, personas, topic, turns }, "Processing simulation job")

    const result = await agent.run({
      streamId,
      workspaceId,
      memberId,
      personas,
      topic,
      turns,
    })

    if (result.status === "failed") {
      throw new Error(`Simulation failed: ${result.error}`)
    }

    logger.info({ jobId: job.id, messagesSent: result.messagesSent }, "Simulation job completed")
  }
}
