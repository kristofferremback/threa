import type { Pool, PoolClient } from "pg"
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres"
import { withClient } from "../db"
import { AuthorTypes, CompanionModes, type AuthorType } from "../lib/constants"
import type { ProviderRegistry } from "../lib/ai"
import { StreamRepository } from "../repositories/stream-repository"
import { MessageRepository } from "../repositories/message-repository"
import { PersonaRepository, type Persona } from "../repositories/persona-repository"
import {
  AgentSessionRepository,
  SessionStatuses,
  type AgentSession,
} from "../repositories/agent-session-repository"
import { runCompanionGraph } from "./companion-runner"
import { sessionId } from "../lib/id"
import { logger } from "../lib/logger"

const MAX_CONTEXT_MESSAGES = 20

export type WithSessionResult<T> =
  | { skip: true; reason: string }
  | { skip: false; session: AgentSession; data: T }

/**
 * Helper to get or create a session for a trigger message.
 * Returns skip if session is already completed, otherwise provides session
 * and runs the callback to collect additional data in the same transaction.
 */
export async function withSession<T>(
  client: PoolClient,
  params: {
    triggerMessageId: string
    streamId: string
    personaId: string
    serverId: string
  },
  getData: (client: PoolClient) => Promise<T>,
): Promise<WithSessionResult<T>> {
  const { triggerMessageId, streamId, personaId, serverId } = params

  // Check for existing session
  let session = await AgentSessionRepository.findByTriggerMessage(client, triggerMessageId)

  if (session?.status === SessionStatuses.COMPLETED) {
    logger.info({ sessionId: session.id }, "Session already completed")
    return { skip: true, reason: "session already completed" }
  }

  // Create or resume session
  if (!session) {
    session = await AgentSessionRepository.insert(client, {
      id: sessionId(),
      streamId,
      personaId,
      triggerMessageId,
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
    return { skip: true, reason: "failed to create session" }
  }

  const data = await getData(client)
  return { skip: false, session, data }
}

/**
 * Dependencies required to construct a CompanionAgent.
 */
export interface CompanionAgentDeps {
  pool: Pool
  modelRegistry: ProviderRegistry
  checkpointer: PostgresSaver
  createMessage: (params: {
    workspaceId: string
    streamId: string
    authorId: string
    authorType: AuthorType
    content: string
  }) => Promise<{ id: string }>
}

/**
 * Input parameters for running the companion agent.
 */
export interface CompanionAgentInput {
  streamId: string
  messageId: string
  serverId: string
}

/**
 * Result from running the companion agent.
 */
export interface CompanionAgentResult {
  sessionId: string | null
  responseMessageId: string | null
  status: "completed" | "failed" | "skipped"
  skipReason?: string
}

/**
 * Companion agent that responds to messages in streams.
 *
 * Encapsulates all dependencies so callers only need to call run(input).
 * This enables reuse across different invocation contexts (job workers,
 * API endpoints, evals) without exposing internal dependencies.
 */
export class CompanionAgent {
  constructor(private readonly deps: CompanionAgentDeps) {}

  /**
   * Run the companion agent for a given message in a stream.
   *
   * This is the main orchestration method that:
   * 1. Loads stream context and validates companion mode
   * 2. Resolves the persona to use
   * 3. Creates or resumes an agent session
   * 4. Loads conversation history
   * 5. Runs the LangGraph agent
   * 6. Posts the response message
   * 7. Updates session status
   */
  async run(input: CompanionAgentInput): Promise<CompanionAgentResult> {
    const { pool, modelRegistry, checkpointer, createMessage } = this.deps
    const { streamId, messageId, serverId } = input

    // Step 1: Load context and create/get session
    const context = await withClient(pool, async (client) => {
      const stream = await StreamRepository.findById(client, streamId)
      if (!stream || stream.companionMode !== CompanionModes.ON) {
        return { skip: true as const, reason: "stream not found or companion mode off" }
      }

      const persona = await getPersona(client, stream.companionPersonaId)
      if (!persona) {
        logger.error({ streamId }, "No persona found")
        return { skip: true as const, reason: "no persona found" }
      }

      const sessionResult = await withSession(
        client,
        { triggerMessageId: messageId, streamId, personaId: persona.id, serverId },
        async (c) => {
          const recentMessages = await MessageRepository.list(c, streamId, {
            limit: MAX_CONTEXT_MESSAGES,
          })
          return { stream, persona, recentMessages }
        },
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

    const { session, stream, persona, recentMessages } = context

    try {
      // Step 2: Run agent via LangGraph
      const systemPrompt = buildSystemPrompt(persona, stream)
      const result = await runCompanionGraph(
        { modelRegistry, checkpointer },
        {
          threadId: session.id,
          modelId: persona.model,
          systemPrompt,
          messages: recentMessages.map((m) => ({
            role: m.authorType === AuthorTypes.USER ? ("user" as const) : ("assistant" as const),
            content: m.content,
          })),
        },
      )

      // Step 3: Post response
      const responseMessage = await createMessage({
        workspaceId: stream.workspaceId,
        streamId,
        authorId: persona.id,
        authorType: AuthorTypes.PERSONA,
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

      return {
        sessionId: session.id,
        responseMessageId: responseMessage.id,
        status: "completed",
      }
    } catch (error) {
      logger.error(
        { error, sessionId: session.id },
        "Companion agent failed",
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

      return {
        sessionId: session.id,
        responseMessageId: null,
        status: "failed",
      }
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
 * Requires persona to have a system prompt configured.
 */
function buildSystemPrompt(
  persona: Persona,
  stream: { type: string; displayName: string | null; description: string | null },
): string {
  if (!persona.systemPrompt) {
    throw new Error(`Persona "${persona.name}" (${persona.id}) has no system prompt configured`)
  }

  let prompt = persona.systemPrompt

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
