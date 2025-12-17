import type { Pool } from "pg"
import { withClient } from "../db"
import { CompanionModes, AuthorTypes, type AuthorType } from "../lib/constants"
import { StreamRepository } from "../repositories/stream-repository"
import { PersonaRepository } from "../repositories/persona-repository"
import {
  AgentSessionRepository,
  SessionStatuses,
  StepTypes,
} from "../repositories/agent-session-repository"
import { stepId } from "../lib/id"
import { logger } from "../lib/logger"
import { withSession, type CompanionAgentInput, type CompanionAgentResult } from "./companion-agent"

const STUB_RESPONSE = "This is a stub response from the companion. The real AI integration is disabled."

/**
 * Dependencies required to construct a StubCompanionAgent.
 */
export interface StubCompanionAgentDeps {
  pool: Pool
  createMessage: (params: {
    workspaceId: string
    streamId: string
    authorId: string
    authorType: AuthorType
    content: string
  }) => Promise<{ id: string }>
}

/**
 * Stub version of the companion agent for testing.
 * Does not call real AI - just creates a session and posts a canned response.
 *
 * Useful for:
 * - E2E tests that verify the job flow without LLM costs
 * - Development without API keys
 * - Load testing the infrastructure
 */
export class StubCompanionAgent {
  constructor(private readonly deps: StubCompanionAgentDeps) {}

  async run(input: CompanionAgentInput): Promise<CompanionAgentResult> {
    const { pool, createMessage } = this.deps
    const { streamId, messageId, serverId } = input

    logger.info(
      { streamId, messageId },
      "Running companion agent (STUB)",
    )

    const context = await withClient(pool, async (client) => {
      const stream = await StreamRepository.findById(client, streamId)
      if (!stream || stream.companionMode !== CompanionModes.ON) {
        return { skip: true as const, reason: "stream not found or companion mode off" }
      }

      // Get persona - fail if not configured
      let personaId = stream.companionPersonaId
      if (!personaId) {
        const defaultPersona = await PersonaRepository.getSystemDefault(client)
        if (!defaultPersona) {
          return { skip: true as const, reason: "no persona configured and no system default" }
        }
        personaId = defaultPersona.id
      }

      const sessionResult = await withSession(
        client,
        { triggerMessageId: messageId, streamId, personaId, serverId },
        async () => ({ stream, personaId }),
      )

      if (sessionResult.skip) {
        return { skip: true as const, reason: sessionResult.reason }
      }

      return {
        skip: false as const,
        session: sessionResult.session,
        ...sessionResult.data,
      }
    })

    if (context.skip) {
      return {
        sessionId: null,
        responseMessageId: null,
        status: "skipped",
        skipReason: context.reason,
      }
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
        authorType: AuthorTypes.PERSONA,
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

      return {
        sessionId: session.id,
        responseMessageId: responseMessage.id,
        status: "completed",
      }
    } catch (error) {
      logger.error({ error, sessionId: session.id }, "Stub companion agent failed")

      await withClient(pool, async (client) => {
        await AgentSessionRepository.updateStatus(
          client,
          session.id,
          SessionStatuses.FAILED,
          { error: String(error) },
        )
      }).catch(() => {})

      return {
        sessionId: session.id,
        responseMessageId: null,
        status: "failed",
      }
    }
  }
}
