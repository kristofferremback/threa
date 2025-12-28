import type { Pool, PoolClient } from "pg"
import { withClient } from "../db"
import { AgentToolNames, AuthorTypes, StreamTypes, type AuthorType } from "@threa/types"
import { StreamRepository } from "../repositories/stream-repository"
import { MessageRepository } from "../repositories/message-repository"
import { PersonaRepository, type Persona } from "../repositories/persona-repository"
import { AgentSessionRepository, SessionStatuses, type AgentSession } from "../repositories/agent-session-repository"
import { StreamEventRepository } from "../repositories/stream-event-repository"
import type { ResponseGenerator, ResponseGeneratorCallbacks } from "./companion-runner"
import { isToolEnabled, type SendMessageInputWithSources, type SendMessageResult, type SourceItem } from "./tools"
import { buildStreamContext, type StreamContext } from "./context-builder"
import { sessionId } from "../lib/id"
import { logger } from "../lib/logger"

export type MentionInvokeResult =
  | { status: "skipped"; sessionId: null; reason: string }
  | { status: "completed"; sessionId: string; messagesSent: number; sentMessageIds: string[] }
  | { status: "failed"; sessionId: string }

/**
 * Dependencies required to construct a MentionInvokeAgent.
 */
export interface MentionInvokeAgentDeps {
  pool: Pool
  responseGenerator: ResponseGenerator
  createMessage: (params: {
    workspaceId: string
    streamId: string
    authorId: string
    authorType: AuthorType
    content: string
    sources?: SourceItem[]
  }) => Promise<{ id: string }>
}

/**
 * Input parameters for running the mention invoke agent.
 */
export interface MentionInvokeAgentInput {
  workspaceId: string
  streamId: string
  messageId: string
  personaId: string
  targetStreamId: string
  serverId: string
}

/**
 * Agent that responds when a persona is @mentioned.
 *
 * Unlike CompanionAgent which requires companionMode to be enabled,
 * this agent responds to explicit @mentions of a persona in any stream.
 *
 * Response location by stream type:
 * - Channel: Responds in a thread (targetStreamId is the thread)
 * - Thread: Responds directly in the thread
 * - Scratchpad: Responds directly in the scratchpad
 * - DM: Responds directly in the DM
 */
export class MentionInvokeAgent {
  constructor(private readonly deps: MentionInvokeAgentDeps) {}

  async run(input: MentionInvokeAgentInput): Promise<MentionInvokeResult> {
    const { pool, responseGenerator, createMessage } = this.deps
    const { workspaceId, streamId, messageId, personaId, targetStreamId, serverId } = input

    // Step 1: Load and validate persona
    const precheck = await withClient(pool, async (client) => {
      const persona = await PersonaRepository.findById(client, personaId)
      if (!persona || persona.status !== "active") {
        return { skip: true as const, reason: "persona not found or inactive" }
      }

      // Get target stream for response context
      const targetStream = await StreamRepository.findById(client, targetStreamId)
      if (!targetStream) {
        return { skip: true as const, reason: "target stream not found" }
      }

      // Get the current max sequence to use as initial lastProcessedSequence
      const latestSequence = await StreamEventRepository.getLatestSequence(client, targetStreamId)

      return {
        skip: false as const,
        persona,
        targetStream,
        initialSequence: latestSequence ?? BigInt(0),
      }
    })

    if (precheck.skip) {
      return {
        sessionId: null,
        status: "skipped",
        reason: precheck.reason,
      }
    }

    const { persona, targetStream, initialSequence } = precheck

    // Step 2: Run with session lifecycle management
    const result = await this.withSession(
      {
        pool,
        triggerMessageId: messageId,
        streamId: targetStreamId,
        personaId: persona.id,
        serverId,
        initialSequence,
      },
      async (client, session) => {
        // Build stream context from target stream (includes conversation history)
        const context = await buildStreamContext(client, targetStreamId, messageId)
        if (!context) {
          throw new Error(`Failed to build context for stream ${targetStreamId}`)
        }

        // Build system prompt with stream context and invocation context
        const systemPrompt = buildSystemPrompt(persona, context, streamId !== targetStreamId)

        // Create callbacks for the response generator
        const callbacks: ResponseGeneratorCallbacks = {
          sendMessage: async (msgInput: SendMessageInputWithSources): Promise<SendMessageResult> => {
            const message = await createMessage({
              workspaceId,
              streamId: targetStreamId,
              authorId: persona.id,
              authorType: AuthorTypes.PERSONA,
              content: msgInput.content,
              sources: msgInput.sources,
            })
            return { messageId: message.id, content: msgInput.content }
          },

          sendMessageWithSources: async (msgInput: SendMessageInputWithSources): Promise<SendMessageResult> => {
            const message = await createMessage({
              workspaceId,
              streamId: targetStreamId,
              authorId: persona.id,
              authorType: AuthorTypes.PERSONA,
              content: msgInput.content,
              sources: msgInput.sources,
            })
            return { messageId: message.id, content: msgInput.content }
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
            messages: context.conversationHistory.map((m) => ({
              role: m.authorType === AuthorTypes.USER ? ("user" as const) : ("assistant" as const),
              content: m.content,
            })),
            streamId: targetStreamId,
            sessionId: session.id,
            personaId: persona.id,
            lastProcessedSequence: session.lastSeenSequence ?? initialSequence,
            enabledTools: persona.enabledTools,
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
          status: "skipped",
          reason: result.reason,
        }

      case "failed":
        return {
          sessionId: result.sessionId,
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

  /**
   * Manages the complete lifecycle of an agent session.
   */
  private async withSession(
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
  ): Promise<MentionInvokeResult> {
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

        await AgentSessionRepository.updateLastSeenSequence(client, session.id, lastSeenSequence)

        await AgentSessionRepository.updateStatus(client, session.id, SessionStatuses.COMPLETED, {
          responseMessageId: sentMessageIds[0] ?? null,
          sentMessageIds,
        })

        logger.info({ sessionId: session.id, messagesSent, sentMessageIds }, "Mention invoke session completed")

        return {
          status: "completed" as const,
          sessionId: session.id,
          messagesSent,
          sentMessageIds,
        }
      } catch (err) {
        logger.error({ err, sessionId: session.id }, "Mention invoke session failed")

        await AgentSessionRepository.updateStatus(client, session.id, SessionStatuses.FAILED, {
          error: String(err),
        }).catch((e) => logger.error({ err: e }, "Failed to mark session as failed"))

        return { status: "failed" as const, sessionId: session.id }
      }
    })
  }
}

/**
 * Build the system prompt for the mention invoke agent.
 */
function buildSystemPrompt(persona: Persona, context: StreamContext, wasInvokedFromChannel: boolean): string {
  if (!persona.systemPrompt) {
    throw new Error(`Persona "${persona.name}" (${persona.id}) has no system prompt configured`)
  }

  let prompt = persona.systemPrompt

  // Add mention invocation context
  prompt += `

## Invocation Context

You were explicitly @mentioned by a user who wants your assistance.`

  if (wasInvokedFromChannel) {
    prompt += ` This conversation is happening in a thread created specifically for your response.`
  }

  // Add stream-type-specific context
  switch (context.streamType) {
    case StreamTypes.SCRATCHPAD:
      prompt += buildScratchpadPrompt(context)
      break

    case StreamTypes.CHANNEL:
      prompt += buildChannelPrompt(context)
      break

    case StreamTypes.THREAD:
      prompt += buildThreadPrompt(context)
      break

    case StreamTypes.DM:
      prompt += buildDmPrompt(context)
      break

    default:
      prompt += buildScratchpadPrompt(context)
  }

  // Add send_message tool instructions
  prompt += `

## Responding to Messages

You have a \`send_message\` tool to send messages to the conversation. Use this tool when you want to respond.

Key behaviors:
- Call send_message to send a response. You can call it multiple times for multi-part responses.
- If you have nothing to add (e.g., the question was already answered), simply don't call send_message.
- If new messages arrive while you're processing, you'll see them and can incorporate them in your response.
- Be helpful, concise, and conversational.`

  // Add web search tool instructions if enabled
  if (isToolEnabled(persona.enabledTools, AgentToolNames.WEB_SEARCH)) {
    prompt += `

## Web Search

You have a \`web_search\` tool to search the web for current information.

When using web search:
- Search when you need up-to-date information not in your training data
- Search for facts, current events, or specific details you're uncertain about
- Cite sources in your responses using markdown links: [Title](URL)
- Use the snippets to answer accurately`
  }

  // Add read_url tool instructions if enabled
  if (isToolEnabled(persona.enabledTools, AgentToolNames.READ_URL)) {
    prompt += `

## Reading URLs

You have a \`read_url\` tool to fetch and read the full content of a web page.

When to use read_url:
- After web_search when you need more detail than the snippet provides
- When the user shares a specific URL they want you to analyze
- To verify information or get complete context from a source`
  }

  return prompt
}

function buildScratchpadPrompt(context: StreamContext): string {
  let section = "\n\n## Context\n\n"
  section += "You are in a personal scratchpad"

  if (context.streamInfo.name) {
    section += ` called "${context.streamInfo.name}"`
  }
  section += ". This is a private, personal space for notes and thinking. "
  section += "The conversation history is your primary context."

  if (context.streamInfo.description) {
    section += `\n\nDescription: ${context.streamInfo.description}`
  }

  return section
}

function buildChannelPrompt(context: StreamContext): string {
  let section = "\n\n## Context\n\n"
  section += "You are in a channel"

  if (context.streamInfo.name) {
    section += ` called "${context.streamInfo.name}"`
  }
  if (context.streamInfo.slug) {
    section += ` (#${context.streamInfo.slug})`
  }
  section += ". This is a collaborative space where team members can discuss topics together."

  if (context.streamInfo.description) {
    section += `\n\nChannel description: ${context.streamInfo.description}`
  }

  if (context.participants && context.participants.length > 0) {
    section += "\n\nChannel members:\n"
    for (const p of context.participants) {
      section += `- ${p.name}\n`
    }
  }

  return section
}

function buildThreadPrompt(context: StreamContext): string {
  let section = "\n\n## Context\n\n"
  section += "You are in a thread"

  if (context.streamInfo.name) {
    section += ` called "${context.streamInfo.name}"`
  }
  section += ". This is a focused discussion branching from a parent conversation."

  if (context.streamInfo.description) {
    section += `\n\nThread description: ${context.streamInfo.description}`
  }

  if (context.threadContext && context.threadContext.path.length > 1) {
    section += `\n\nThread hierarchy (${context.threadContext.depth} levels deep):\n`

    for (let i = 0; i < context.threadContext.path.length; i++) {
      const entry = context.threadContext.path[i]
      const indent = "  ".repeat(i)
      const name = entry.displayName ?? "Untitled"

      if (i === 0) {
        section += `${indent}[Root] ${name}\n`
      } else if (i === context.threadContext.path.length - 1) {
        section += `${indent}[Current] ${name}\n`
      } else {
        section += `${indent}└─ ${name}\n`
      }

      if (entry.anchorMessage) {
        section += `${indent}   Spawned from: "${entry.anchorMessage.content}" (by ${entry.anchorMessage.authorName})\n`
      }
    }
  }

  return section
}

function buildDmPrompt(context: StreamContext): string {
  let section = "\n\n## Context\n\n"
  section += "You are in a direct message conversation"

  if (context.participants && context.participants.length > 0) {
    const names = context.participants.map((p) => p.name).join(" and ")
    section += ` between ${names}`
  }
  section += ". This is a private, focused conversation between two people."

  if (context.streamInfo.description) {
    section += `\n\nDescription: ${context.streamInfo.description}`
  }

  return section
}
