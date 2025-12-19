import type { Pool, PoolClient } from "pg"
import { withClient, withTransaction } from "../db"
import { AuthorTypes, CompanionModes, type AuthorType } from "@threa/types"
import { StreamRepository } from "../repositories/stream-repository"
import { MessageRepository } from "../repositories/message-repository"
import { PersonaRepository, type Persona } from "../repositories/persona-repository"
import { AgentSessionRepository, SessionStatuses, type AgentSession } from "../repositories/agent-session-repository"
import { StreamEventRepository } from "../repositories/stream-event-repository"
import type { ResponseGenerator, ResponseGeneratorCallbacks } from "./companion-runner"
import type { SendMessageInput, SendMessageResult } from "./tools/send-message-tool"
import { sessionId } from "../lib/id"
import { logger } from "../lib/logger"

const MAX_CONTEXT_MESSAGES = 20

export type WithSessionResult =
  | { status: "skipped"; sessionId: null; reason: string }
  | { status: "completed"; sessionId: string; messagesSent: number; sentMessageIds: string[] }
  | { status: "failed"; sessionId: string }

/**
 * Manages the complete lifecycle of an agent session.
 */
export async function withSession(
  params: {
    pool: Pool
    triggerMessageId: string
    streamId: string
    personaId: string
    serverId: string
    initialSequence: bigint
  },
  work: (
    client: PoolClient,
    session: AgentSession
  ) => Promise<{ messagesSent: number; sentMessageIds: string[]; lastSeenSequence: bigint }>
): Promise<WithSessionResult> {
  const { pool, triggerMessageId, streamId, personaId, serverId, initialSequence } = params

  return withClient(pool, async (client) => {
    // Check for already running session on this stream (concurrency control)
    const runningSession = await AgentSessionRepository.findRunningByStream(client, streamId)
    if (runningSession) {
      logger.info({ streamId, existingSessionId: runningSession.id }, "Agent already running for stream, skipping")
      return {
        status: "skipped" as const,
        sessionId: null,
        reason: "agent already running for stream",
      }
    }

    // Find or create session
    let session = await AgentSessionRepository.findByTriggerMessage(client, triggerMessageId)

    if (session?.status === SessionStatuses.COMPLETED) {
      logger.info({ sessionId: session.id }, "Session already completed")
      return {
        status: "skipped" as const,
        sessionId: null,
        reason: "session already completed",
      }
    }

    if (!session) {
      session = await AgentSessionRepository.insert(client, {
        id: sessionId(),
        streamId,
        personaId,
        triggerMessageId,
        status: SessionStatuses.RUNNING,
        serverId,
      })
      // Set initial last seen sequence
      await AgentSessionRepository.updateLastSeenSequence(client, session.id, initialSequence)
    } else {
      session = await AgentSessionRepository.updateStatus(client, session.id, SessionStatuses.RUNNING, {
        serverId,
      })
    }

    if (!session) {
      return {
        status: "skipped" as const,
        sessionId: null,
        reason: "failed to create session",
      }
    }

    // Run work and track status
    try {
      const { messagesSent, sentMessageIds, lastSeenSequence } = await work(client, session)

      // Update last seen sequence before completing
      await AgentSessionRepository.updateLastSeenSequence(client, session.id, lastSeenSequence)

      await AgentSessionRepository.updateStatus(client, session.id, SessionStatuses.COMPLETED, {
        responseMessageId: sentMessageIds[0] ?? null,
        sentMessageIds,
      })

      logger.info({ sessionId: session.id, messagesSent, sentMessageIds }, "Session completed")

      return {
        status: "completed" as const,
        sessionId: session.id,
        messagesSent,
        sentMessageIds,
      }
    } catch (err) {
      logger.error({ err, sessionId: session.id }, "Session failed")

      await AgentSessionRepository.updateStatus(client, session.id, SessionStatuses.FAILED, {
        error: String(err),
      }).catch((e) => logger.error({ err: e }, "Failed to mark session as failed"))

      return { status: "failed" as const, sessionId: session.id }
    }
  })
}

/**
 * Dependencies required to construct a CompanionAgent.
 */
export interface CompanionAgentDeps {
  pool: Pool
  responseGenerator: ResponseGenerator
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
  messagesSent: number
  sentMessageIds: string[]
  status: "completed" | "failed" | "skipped"
  skipReason?: string
}

/**
 * Companion agent that responds to messages in streams.
 */
export class CompanionAgent {
  constructor(private readonly deps: CompanionAgentDeps) {}

  /**
   * Run the companion agent for a given message in a stream.
   */
  async run(input: CompanionAgentInput): Promise<CompanionAgentResult> {
    const { pool, responseGenerator, createMessage } = this.deps
    const { streamId, messageId, serverId } = input

    // Step 1: Load and validate stream/persona
    const precheck = await withClient(pool, async (client) => {
      const stream = await StreamRepository.findById(client, streamId)
      if (!stream || stream.companionMode !== CompanionModes.ON) {
        return {
          skip: true as const,
          reason: "stream not found or companion mode off",
        }
      }

      const persona = await getPersona(client, stream.companionPersonaId)
      if (!persona) {
        logger.error({ streamId }, "No persona found")
        return { skip: true as const, reason: "no persona found" }
      }

      // Get the current max sequence to use as initial lastProcessedSequence
      const latestSequence = await StreamEventRepository.getLatestSequence(client, streamId)

      return {
        skip: false as const,
        stream,
        persona,
        initialSequence: latestSequence ?? BigInt(0),
      }
    })

    if (precheck.skip) {
      return {
        sessionId: null,
        messagesSent: 0,
        sentMessageIds: [],
        status: "skipped",
        skipReason: precheck.reason,
      }
    }

    const { stream, persona, initialSequence } = precheck

    // Step 2: Run with session lifecycle management
    const result = await withSession(
      {
        pool,
        triggerMessageId: messageId,
        streamId,
        personaId: persona.id,
        serverId,
        initialSequence,
      },
      async (client, session) => {
        // Load conversation history
        const recentMessages = await MessageRepository.list(client, streamId, {
          limit: MAX_CONTEXT_MESSAGES,
        })

        // Build system prompt with send_message instructions
        const systemPrompt = buildSystemPrompt(persona, stream)

        // Create callbacks for the response generator
        const callbacks: ResponseGeneratorCallbacks = {
          sendMessage: async (input: SendMessageInput): Promise<SendMessageResult> => {
            const message = await createMessage({
              workspaceId: stream.workspaceId,
              streamId,
              authorId: persona.id,
              authorType: AuthorTypes.PERSONA,
              content: input.content,
            })
            return { messageId: message.id, content: input.content }
          },

          checkNewMessages: async (checkStreamId: string, sinceSequence: bigint, excludeAuthorId: string) => {
            const messages = await MessageRepository.listSince(client, checkStreamId, sinceSequence, {
              excludeAuthorId,
            })
            return messages.map((m) => ({
              sequence: m.sequence,
              content: m.content,
              authorId: m.authorId,
            }))
          },

          updateLastSeenSequence: async (updateSessionId: string, sequence: bigint) => {
            await AgentSessionRepository.updateLastSeenSequence(client, updateSessionId, sequence)
          },
        }

        // Generate response
        const aiResult = await responseGenerator.run(
          {
            threadId: session.id,
            modelId: persona.model,
            systemPrompt,
            messages: recentMessages.map((m) => ({
              role: m.authorType === AuthorTypes.USER ? ("user" as const) : ("assistant" as const),
              content: m.content,
            })),
            streamId,
            sessionId: session.id,
            personaId: persona.id,
            lastProcessedSequence: session.lastSeenSequence ?? initialSequence,
          },
          callbacks
        )

        return {
          messagesSent: aiResult.messagesSent,
          sentMessageIds: aiResult.sentMessageIds,
          lastSeenSequence: aiResult.lastProcessedSequence,
        }
      }
    )

    switch (result.status) {
      case "skipped":
        return {
          sessionId: null,
          messagesSent: 0,
          sentMessageIds: [],
          status: "skipped",
          skipReason: result.reason,
        }

      case "failed":
        return {
          sessionId: result.sessionId,
          messagesSent: 0,
          sentMessageIds: [],
          status: "failed",
        }

      case "completed":
        return {
          sessionId: result.sessionId,
          messagesSent: result.messagesSent,
          sentMessageIds: result.sentMessageIds,
          status: "completed",
        }
    }
  }
}

async function getPersona(client: PoolClient, personaId: string | null): Promise<Persona | null> {
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
  stream: {
    type: string
    displayName: string | null
    description: string | null
  }
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

  // Add send_message tool instructions
  prompt += `

## Responding to Messages

You have a \`send_message\` tool to send messages to the conversation. Use this tool when you want to respond.

Key behaviors:
- Call send_message to send a response. You can call it multiple times for multi-part responses.
- If you have nothing to add (e.g., the question was already answered), simply don't call send_message.
- If new messages arrive while you're processing, you'll see them and can incorporate them in your response.
- Be helpful, concise, and conversational.`

  return prompt
}
