import type { Pool } from "pg"
import { withClient } from "../db"
import type { CompanionJobData, JobHandler } from "../lib/job-queue"
import { CompanionModes } from "../lib/constants"
import { StreamRepository } from "../repositories/stream-repository"
import { PersonaRepository } from "../repositories/persona-repository"
import {
  AgentSessionRepository,
  SessionStatuses,
  StepTypes,
} from "../repositories/agent-session-repository"
import { sessionId, stepId } from "../lib/id"
import { logger } from "../lib/logger"

const STUB_RESPONSE = "This is a stub response from the companion. The real AI integration is disabled."

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
 * Does not call real AI - just creates a session and posts a canned response.
 *
 * Useful for:
 * - E2E tests that verify the job flow without LLM costs
 * - Development without API keys
 * - Load testing the infrastructure
 */
export function createStubCompanionWorker(
  deps: StubCompanionWorkerDeps,
): JobHandler<CompanionJobData> {
  const { pool, serverId, createMessage } = deps

  // Track calls for test assertions
  const calls: CompanionJobData[] = []

  const handler: JobHandler<CompanionJobData> & { calls: CompanionJobData[] } = async (job) => {
    const { streamId, messageId, triggeredBy } = job.data
    calls.push(job.data)

    logger.info(
      { jobId: job.id, streamId, messageId },
      "Processing companion job (STUB)",
    )

    const context = await withClient(pool, async (client) => {
      const stream = await StreamRepository.findById(client, streamId)
      if (!stream || stream.companionMode !== CompanionModes.ON) {
        return null
      }

      // Get persona - fail if not configured
      let personaId = stream.companionPersonaId
      if (!personaId) {
        const defaultPersona = await PersonaRepository.getSystemDefault(client)
        if (!defaultPersona) {
          throw new Error("No persona configured and no system default available")
        }
        personaId = defaultPersona.id
      }

      // Check for existing session
      let session = await AgentSessionRepository.findByTriggerMessage(client, messageId)

      if (session?.status === SessionStatuses.COMPLETED) {
        logger.info({ sessionId: session.id }, "Session already completed (STUB)")
        return null
      }

      // Create or resume session
      if (!session) {
        session = await AgentSessionRepository.insert(client, {
          id: sessionId(),
          streamId,
          personaId,
          triggerMessageId: messageId,
          status: SessionStatuses.RUNNING,
          serverId,
        })
      } else {
        session = await AgentSessionRepository.updateStatus(
          client,
          session.id,
          SessionStatuses.RUNNING,
          { serverId },
        )
      }

      if (!session) {
        return null
      }

      return { session, stream, personaId }
    })

    if (!context) {
      return
    }

    const { session, stream, personaId } = context

    try {
      // Record a single step
      await withClient(pool, async (client) => {
        await AgentSessionRepository.insertStep(client, {
          id: stepId(),
          sessionId: session.id,
          stepNumber: 1,
          stepType: StepTypes.RESPONSE,
          content: { text: STUB_RESPONSE, stub: true },
          tokensUsed: 0,
        })
        await AgentSessionRepository.updateCurrentStep(client, session.id, 1)
      })

      // Post stub response
      const responseMessage = await createMessage({
        workspaceId: stream.workspaceId,
        streamId,
        authorId: personaId,
        authorType: "persona",
        content: STUB_RESPONSE,
      })

      // Mark complete
      await withClient(pool, async (client) => {
        await AgentSessionRepository.updateStatus(
          client,
          session.id,
          SessionStatuses.COMPLETED,
          { responseMessageId: responseMessage.id },
        )
      })

      logger.info(
        { sessionId: session.id, responseMessageId: responseMessage.id },
        "Companion response posted (STUB)",
      )
    } catch (error) {
      logger.error({ error, sessionId: session.id }, "Stub companion job failed")

      await withClient(pool, async (client) => {
        await AgentSessionRepository.updateStatus(
          client,
          session.id,
          SessionStatuses.FAILED,
          { error: String(error) },
        )
      }).catch(() => {})

      throw error
    }
  }

  handler.calls = calls
  return handler
}
