import type { Pool, PoolClient } from "pg"
import { withClient } from "../db"
import { AgentToolNames, AuthorTypes, StreamTypes, type AuthorType } from "@threa/types"
import { StreamRepository } from "../repositories/stream-repository"
import { MessageRepository, type Message } from "../repositories/message-repository"
import { PersonaRepository, type Persona } from "../repositories/persona-repository"
import { UserRepository } from "../repositories/user-repository"
import { AgentSessionRepository, SessionStatuses, type AgentSession } from "../repositories/agent-session-repository"
import { StreamEventRepository } from "../repositories/stream-event-repository"
import type { ResponseGenerator, ResponseGeneratorCallbacks } from "./companion-runner"
import { isToolEnabled, type SendMessageInputWithSources, type SendMessageResult, type SourceItem } from "./tools"
import { buildStreamContext, type StreamContext } from "./context-builder"
import { sessionId } from "../lib/id"
import { logger } from "../lib/logger"
import { formatTime, getDateKey, formatDate, buildTemporalPromptSection, type TemporalContext } from "../lib/temporal"

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
 * Dependencies required to construct a PersonaAgent.
 */
export interface PersonaAgentDeps {
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
  createThread: (params: {
    workspaceId: string
    parentStreamId: string
    parentMessageId: string
    createdBy: string
  }) => Promise<{ id: string }>
}

/**
 * Input parameters for running the persona agent.
 */
export interface PersonaAgentInput {
  workspaceId: string
  streamId: string // Where message was sent
  messageId: string // Trigger message
  personaId: string // Which persona to invoke
  serverId: string
  trigger?: "mention" // undefined = companion mode
}

/**
 * Result from running the persona agent.
 */
export interface PersonaAgentResult {
  sessionId: string | null
  messagesSent: number
  sentMessageIds: string[]
  status: "completed" | "failed" | "skipped"
  skipReason?: string
}

/**
 * Unified persona agent that handles both companion mode and @mention invocations.
 *
 * The agent receives explicit personaId and trigger context - listeners handle
 * the source-specific logic (companion mode checks, @mention extraction).
 *
 * For channel mentions, the agent creates a thread lazily on first message send.
 */
export class PersonaAgent {
  constructor(private readonly deps: PersonaAgentDeps) {}

  /**
   * Run the persona agent for a given message.
   */
  async run(input: PersonaAgentInput): Promise<PersonaAgentResult> {
    const { pool, responseGenerator, createMessage, createThread } = this.deps
    const { workspaceId, streamId, messageId, personaId, serverId, trigger } = input

    // Step 1: Load and validate persona and stream
    const precheck = await withClient(pool, async (client) => {
      const persona = await PersonaRepository.findById(client, personaId)
      if (!persona || persona.status !== "active") {
        return { skip: true as const, reason: "persona not found or inactive" }
      }

      const stream = await StreamRepository.findById(client, streamId)
      if (!stream) {
        return { skip: true as const, reason: "stream not found" }
      }

      // Get the current max sequence to use as initial lastProcessedSequence
      const latestSequence = await StreamEventRepository.getLatestSequence(client, streamId)

      return {
        skip: false as const,
        persona,
        stream,
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

    const { persona, stream, initialSequence } = precheck

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
        // Fetch trigger message to get the invoking user
        const triggerMessage = await MessageRepository.findById(client, messageId)
        const invokingUserId = triggerMessage?.authorType === "user" ? triggerMessage.authorId : undefined

        // Build stream context with temporal information
        const context = await buildStreamContext(client, stream, {
          workspaceId,
          invokingUserId,
        })

        // Look up mentioner name if this is a mention trigger
        let mentionerName: string | undefined
        if (trigger === "mention" && triggerMessage?.authorType === "user") {
          const mentioner = await UserRepository.findById(client, triggerMessage.authorId)
          mentionerName = mentioner?.name ?? undefined
        }

        // Build system prompt with stream context, trigger info, and temporal context
        const systemPrompt = buildSystemPrompt(persona, context, trigger, mentionerName)

        // Track target stream for responses - may change if we create a thread
        let targetStreamId = streamId
        let threadCreated = false

        // Helper to send a message, creating a thread for channel mentions on first send
        const doSendMessage = async (msgInput: SendMessageInputWithSources): Promise<SendMessageResult> => {
          // For channel mentions: create thread on first message
          // Note: createThread is idempotent (uses ON CONFLICT DO NOTHING), so retries are safe
          if (trigger === "mention" && context.streamType === StreamTypes.CHANNEL && !threadCreated) {
            const thread = await createThread({
              workspaceId,
              parentStreamId: streamId,
              parentMessageId: messageId,
              createdBy: persona.id,
            })
            targetStreamId = thread.id
            threadCreated = true
            logger.info({ threadId: thread.id, streamId, messageId }, "Created thread for channel mention response")
          }

          const message = await createMessage({
            workspaceId,
            streamId: targetStreamId,
            authorId: persona.id,
            authorType: AuthorTypes.PERSONA,
            content: msgInput.content,
            sources: msgInput.sources,
          })
          return { messageId: message.id, content: msgInput.content }
        }

        // Create callbacks for the response generator
        const callbacks: ResponseGeneratorCallbacks = {
          sendMessage: doSendMessage,
          sendMessageWithSources: doSendMessage,

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

        // Format messages with timestamps if temporal context is available
        const formattedMessages = formatMessagesWithTemporal(context.conversationHistory, context)

        // Generate response
        const aiResult = await responseGenerator.run(
          {
            threadId: session.id,
            modelId: persona.model,
            systemPrompt,
            messages: formattedMessages,
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

/**
 * Build the system prompt for the persona agent.
 * Produces stream-type-specific context and optional mention invocation context.
 */
function buildSystemPrompt(
  persona: Persona,
  context: StreamContext,
  trigger?: "mention",
  mentionerName?: string
): string {
  if (!persona.systemPrompt) {
    throw new Error(`Persona "${persona.name}" (${persona.id}) has no system prompt configured`)
  }

  let prompt = persona.systemPrompt

  // Add mention invocation context if applicable
  if (trigger === "mention") {
    const mentionerDesc = mentionerName ? `**${mentionerName}**` : "a user"
    prompt += `

## Invocation Context

You were explicitly @mentioned by ${mentionerDesc} who wants your assistance.`

    if (context.streamType === StreamTypes.CHANNEL) {
      prompt += ` This conversation is happening in a thread created specifically for your response.`
    }
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

  // Add temporal context at the end (for prompt cache efficiency)
  if (context.temporal) {
    prompt += buildTemporalPromptSection(context.temporal, context.participantTimezones)
  }

  return prompt
}

/**
 * Build prompt section for scratchpads.
 * Personal, solo-first context. Conversation history is primary.
 */
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

/**
 * Build prompt section for channels.
 * Collaborative context with member awareness.
 */
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

/**
 * Build prompt section for threads.
 * Nested discussion with hierarchy awareness.
 */
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

  // Add thread hierarchy context
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

/**
 * Build prompt section for DMs.
 * Two-party context, more focused than channels.
 */
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

/**
 * Format messages for the LLM with timestamps and author names.
 * Includes date boundaries when messages cross dates.
 *
 * Returns messages in standard { role, content } format with enriched content:
 * - User messages: `(14:30) [@name] content`
 * - Assistant messages: `(14:30) content`
 *
 * When temporal context is unavailable, returns messages with original content.
 */
function formatMessagesWithTemporal(
  messages: Message[],
  context: StreamContext
): Array<{ role: "user" | "assistant"; content: string }> {
  const temporal = context.temporal
  if (!temporal) {
    // No temporal context - return messages with original content
    return messages.map((m) => ({
      role: m.authorType === AuthorTypes.USER ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }))
  }

  // Build authorId -> name map from participants
  const authorNames = new Map<string, string>()
  if (context.participants) {
    for (const p of context.participants) {
      authorNames.set(p.id, p.name)
    }
  }

  const result: Array<{ role: "user" | "assistant"; content: string }> = []
  let currentDateKey: string | null = null

  for (const msg of messages) {
    const msgDateKey = getDateKey(msg.createdAt, temporal.timezone)

    // Insert date boundary marker as a system-like user message if date changed
    if (msgDateKey !== currentDateKey) {
      const dateStr = formatDate(msg.createdAt, temporal.timezone, temporal.dateFormat)
      // Add date boundary as a contextual note within the conversation
      result.push({
        role: "user",
        content: `--- ${dateStr} ---`,
      })
      currentDateKey = msgDateKey
    }

    // Format message with timestamp
    const time = formatTime(msg.createdAt, temporal.timezone, temporal.timeFormat)
    const role = msg.authorType === AuthorTypes.USER ? ("user" as const) : ("assistant" as const)

    if (msg.authorType === AuthorTypes.USER) {
      // For user messages in multi-user contexts, include the name
      const authorName = authorNames.get(msg.authorId) ?? "User"
      const hasMultipleUsers = context.streamType === StreamTypes.CHANNEL || context.streamType === StreamTypes.DM
      const namePrefix = hasMultipleUsers ? `[@${authorName}] ` : ""
      result.push({
        role,
        content: `(${time}) ${namePrefix}${msg.content}`,
      })
    } else {
      // Assistant messages - just add timestamp
      result.push({
        role,
        content: `(${time}) ${msg.content}`,
      })
    }
  }

  return result
}
