import type { Pool, PoolClient } from "pg"
import { withClient } from "../db"
import type { CompanionJobData, JobHandler } from "../lib/job-queue"
import { StreamRepository } from "../repositories/stream-repository"
import { MessageRepository } from "../repositories/message-repository"
import { PersonaRepository, type Persona } from "../repositories/persona-repository"
import {
  AgentSessionRepository,
  SessionStatuses,
} from "../repositories/agent-session-repository"
import { runCompanionGraph } from "../agents/companion-runner"
import { sessionId } from "../lib/id"
import { logger } from "../lib/logger"

const MAX_CONTEXT_MESSAGES = 20

export interface CompanionWorkerDeps {
  pool: Pool
  /** OpenRouter API key for LangChain model */
  apiKey: string
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
 * Create the companion job handler for pg-boss.
 */
export function createCompanionWorker(
  deps: CompanionWorkerDeps,
): JobHandler<CompanionJobData> {
  const { pool, apiKey, serverId, createMessage } = deps

  return async (job) => {
    const { streamId, messageId, triggeredBy } = job.data

    logger.info(
      { jobId: job.id, streamId, messageId },
      "Processing companion job",
    )

    // Step 1: Load context and create/get session
    const context = await withClient(pool, async (client) => {
      const stream = await StreamRepository.findById(client, streamId)
      if (!stream || stream.companionMode !== "on") {
        return null
      }

      const persona = await getPersona(client, stream.companionPersonaId)
      if (!persona) {
        logger.error({ streamId }, "No persona found")
        return null
      }

      // Check for existing session
      let session = await AgentSessionRepository.findByTriggerMessage(client, messageId)

      if (session?.status === SessionStatuses.COMPLETED) {
        logger.info({ sessionId: session.id }, "Session already completed")
        return null
      }

      // Create or resume session
      if (!session) {
        session = await AgentSessionRepository.insert(client, {
          id: sessionId(),
          streamId,
          personaId: persona.id,
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

      const recentMessages = await MessageRepository.list(client, streamId, {
        limit: MAX_CONTEXT_MESSAGES,
      })

      return {
        session,
        stream,
        persona,
        recentMessages,
      }
    })

    if (!context) {
      return // Already logged why
    }

    const { session, stream, persona, recentMessages } = context

    try {
      // Step 2: Run agent via LangGraph (checkpointing handled by LangGraph)
      const systemPrompt = buildSystemPrompt(persona, stream)
      const result = await runCompanionGraph(
        { apiKey },
        {
          threadId: session.id,
          modelId: persona.model,
          systemPrompt,
          messages: recentMessages.map((m) => ({
            role: m.authorType === "user" ? ("user" as const) : ("assistant" as const),
            content: m.content,
          })),
        },
      )

      // Step 3: Post response (EventService handles its own transaction)
      const responseMessage = await createMessage({
        workspaceId: stream.workspaceId,
        streamId,
        authorId: persona.id,
        authorType: "persona",
        content: result.response,
      })

      // Step 4: Mark session complete
      await withClient(pool, async (client) => {
        await AgentSessionRepository.updateStatus(
          client,
          session.id,
          SessionStatuses.COMPLETED,
          { responseMessageId: responseMessage.id },
        )
      })

      logger.info(
        {
          sessionId: session.id,
          responseMessageId: responseMessage.id,
        },
        "Companion response posted",
      )
    } catch (error) {
      logger.error(
        { error, sessionId: session.id },
        "Companion job failed",
      )

      // Mark session failed
      await withClient(pool, async (client) => {
        await AgentSessionRepository.updateStatus(
          client,
          session.id,
          SessionStatuses.FAILED,
          { error: String(error) },
        )
      }).catch((e) => logger.error({ e }, "Failed to mark session as failed"))

      throw error // Re-throw for pg-boss retry
    }
  }
}

async function getPersona(
  client: PoolClient,
  personaId: string | null,
): Promise<Persona | null> {
  if (personaId) {
    const persona = await PersonaRepository.findById(client, personaId)
    if (persona?.status === "active") {
      return persona
    }
  }
  return PersonaRepository.getSystemDefault(client)
}

/**
 * Build the system prompt for the companion agent.
 */
function buildSystemPrompt(
  persona: Persona,
  stream: { type: string; displayName: string | null; description: string | null },
): string {
  let prompt =
    persona.systemPrompt || `You are ${persona.name}, an AI companion in a chat application.`

  prompt += `\n\nYou are currently in a ${stream.type}`
  if (stream.displayName) {
    prompt += ` called "${stream.displayName}"`
  }
  if (stream.description) {
    prompt += `: ${stream.description}`
  }
  prompt += "."

  prompt += `\n\nBe helpful, concise, and conversational.`

  return prompt
}
