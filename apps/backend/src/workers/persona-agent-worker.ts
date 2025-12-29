import type { PersonaAgentJobData, JobHandler } from "../lib/job-queue"
import type { PersonaAgentInput, PersonaAgentResult } from "../agents/persona-agent"
import { logger } from "../lib/logger"

/** Interface for any agent that can handle persona agent jobs */
export interface PersonaAgentLike {
  run(input: PersonaAgentInput): Promise<PersonaAgentResult>
}

export interface PersonaAgentWorkerDeps {
  agent: PersonaAgentLike
  serverId: string
}

/**
 * Create the persona agent job handler for pg-boss.
 *
 * This is a thin wrapper that extracts job data and delegates to the persona agent.
 * All business logic lives in the agent module for reusability and testability.
 */
export function createPersonaAgentWorker(deps: PersonaAgentWorkerDeps): JobHandler<PersonaAgentJobData> {
  const { agent, serverId } = deps

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
      // Re-throw to trigger pg-boss retry
      throw new Error(`Persona agent failed for session ${result.sessionId}`)
    }

    logger.info({ jobId: job.id, ...result }, "Persona agent job completed")
  }
}
