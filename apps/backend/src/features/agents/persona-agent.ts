import type { Pool } from "pg"
import { withClient, withTransaction, type Querier } from "../../db"
import {
  AgentTriggers,
  AuthorTypes,
  StreamTypes,
  type AuthorType,
  type UserPreferences,
  type SourceItem,
} from "@threa/types"
import type { UserPreferencesService } from "../user-preferences"
import { StreamRepository } from "../streams"
import { MessageRepository, type Message } from "../messaging"
import { MemberRepository } from "../workspaces"
import { PersonaRepository } from "./persona-repository"
import { AgentSessionRepository, SessionStatuses, type AgentSession } from "./session-repository"
import { OutboxRepository } from "../../lib/outbox"
import { StreamEventRepository } from "../streams"
import { StreamMemberRepository } from "../streams"
import { AttachmentRepository } from "../attachments"
import { AttachmentExtractionRepository } from "../attachments"
import { PdfPageExtractionRepository } from "../attachments"
import type { ResponseGenerator, ResponseGeneratorCallbacks, RecordStepParams } from "./companion-runner"
import { eventId } from "../../lib/id"
import type { TraceEmitter } from "./trace-emitter"
import {
  type SendMessageInputWithSources,
  type SendMessageResult,
  type SearchToolsCallbacks,
  type SearchAttachmentsCallbacks,
  type GetAttachmentCallbacks,
  type LoadAttachmentCallbacks,
  type LoadPdfSectionCallbacks,
  type LoadFileSectionCallbacks,
  type LoadExcelSectionCallbacks,
  type AttachmentSearchResult,
  type AttachmentDetails,
  type LoadAttachmentResult,
  type LoadPdfSectionResult,
  type LoadFileSectionResult,
  type LoadExcelSectionResult,
} from "./tools"
import { buildStreamContext } from "./context-builder"
import { ConversationSummaryService } from "./conversation-summary-service"
import { Researcher, type ResearcherResult, computeAgentAccessSpec, enrichMessageSearchResults } from "./researcher"
import { SearchRepository, type SearchService } from "../search"
import { resolveStreamIdentifier } from "./tools/identifier-resolver"
import type { StorageProvider } from "../../lib/storage/s3-client"
import type { ModelRegistry } from "../../lib/ai/model-registry"
import { awaitAttachmentProcessing } from "../attachments"
import { sessionId } from "../../lib/id"
import { logger } from "../../lib/logger"
import { buildSystemPrompt } from "./companion/prompt/system-prompt"
import { formatMessagesWithTemporal } from "./companion/prompt/message-format"

export type WithSessionResult =
  | { status: "skipped"; sessionId: null; reason: string }
  | { status: "completed"; sessionId: string; messagesSent: number; sentMessageIds: string[]; lastSeenSequence: bigint }
  | { status: "failed"; sessionId: string }

/**
 * Manages the complete lifecycle of an agent session.
 *
 * IMPORTANT: This function does NOT hold a database connection during the work callback.
 * The work callback receives the pool (not a client) so it can acquire short-lived
 * connections as needed. This prevents connection pool exhaustion during long-running
 * AI operations.
 *
 * The connection lifecycle is:
 * 1. Phase 1: Acquire connection → atomically create/find session → release
 * 2. Phase 2: Run work (AI call) WITHOUT holding connection
 * 3. Phase 3: Acquire connection → atomically complete session → release
 *
 * Race condition prevention:
 * - Uses a partial unique index (stream_id WHERE status='running') to ensure
 *   only one running session per stream
 * - INSERT with ON CONFLICT DO NOTHING atomically checks and creates
 */
export async function withSession(
  params: {
    pool: Pool
    triggerMessageId: string
    streamId: string
    personaId: string
    personaName: string
    workspaceId: string
    serverId: string
    initialSequence: bigint
  },
  work: (
    session: AgentSession,
    pool: Pool
  ) => Promise<{ messagesSent: number; sentMessageIds: string[]; lastSeenSequence: bigint }>
): Promise<WithSessionResult> {
  const { pool, triggerMessageId, streamId, personaId, personaName, workspaceId, serverId, initialSequence } = params

  // Phase 1: Session setup (short-lived transaction)
  // Uses atomic insert with ON CONFLICT to prevent race conditions.
  // Transaction ensures session creation + stream event + outbox event commit together.
  const setupResult = await withTransaction(pool, async (db) => {
    // Check if we already have a session for this trigger message
    const existingSession = await AgentSessionRepository.findByTriggerMessage(db, triggerMessageId)

    if (existingSession?.status === SessionStatuses.COMPLETED) {
      logger.info({ sessionId: existingSession.id }, "Session already completed")
      return {
        status: "skipped" as const,
        sessionId: null,
        reason: "session already completed",
      }
    }

    // If there's an existing session (retry scenario), try to resume it
    if (existingSession) {
      const session = await AgentSessionRepository.updateStatus(db, existingSession.id, SessionStatuses.RUNNING, {
        serverId,
      })
      if (!session) {
        return {
          status: "skipped" as const,
          sessionId: null,
          reason: "failed to resume session",
        }
      }
      return { status: "ready" as const, session }
    }

    // No existing session - atomically create one with RUNNING status
    // ON CONFLICT handles the case where another request created a session concurrently
    const session = await AgentSessionRepository.insertRunningOrSkip(db, {
      id: sessionId(),
      streamId,
      personaId,
      triggerMessageId,
      serverId,
      initialSequence,
    })

    if (!session) {
      // Another request won the race and created a session first
      logger.info({ streamId }, "Agent already running for stream (concurrent insert), skipping")
      return {
        status: "skipped" as const,
        sessionId: null,
        reason: "agent already running for stream",
      }
    }

    // Emit agent_session:started stream event + outbox event
    const streamEvent = await StreamEventRepository.insert(db, {
      id: eventId(),
      streamId,
      eventType: "agent_session:started",
      payload: {
        sessionId: session.id,
        personaId,
        personaName,
        triggerMessageId,
        startedAt: session.createdAt.toISOString(),
      },
      actorId: personaId,
      actorType: "persona",
    })
    await OutboxRepository.insert(db, "agent_session:started", {
      workspaceId,
      streamId,
      event: streamEvent,
    })

    return { status: "ready" as const, session }
  })

  // If setup resulted in skip, return early
  if (setupResult.status === "skipped") {
    return setupResult
  }

  const { session } = setupResult

  // Phase 2: Run work WITHOUT holding connection
  // The work callback can use pool directly for short-lived queries
  // Periodic heartbeat keeps the session alive during long AI calls,
  // preventing the orphan cleanup (60s threshold) from killing active sessions.
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined

  try {
    heartbeatInterval = setInterval(async () => {
      try {
        await AgentSessionRepository.updateHeartbeat(pool, session.id)
      } catch (err) {
        logger.warn({ err, sessionId: session.id }, "Heartbeat update failed")
      }
    }, 15_000)

    const { messagesSent, sentMessageIds, lastSeenSequence } = await work(session, pool)

    // Phase 3: Complete session + emit completed event atomically
    try {
      await withTransaction(pool, async (db) => {
        const completed = await AgentSessionRepository.completeSession(db, session.id, {
          lastSeenSequence,
          responseMessageId: sentMessageIds[0] ?? null,
          sentMessageIds,
        })

        // Count actual steps from DB (current_step on session is not reliably incremented)
        const steps = await AgentSessionRepository.findStepsBySession(db, session.id)
        const completedAt = completed?.completedAt ?? new Date()
        const duration = completedAt.getTime() - session.createdAt.getTime()

        const streamEvent = await StreamEventRepository.insert(db, {
          id: eventId(),
          streamId,
          eventType: "agent_session:completed",
          payload: {
            sessionId: session.id,
            stepCount: steps.length,
            messageCount: sentMessageIds.length,
            duration,
            completedAt: completedAt.toISOString(),
          },
          actorId: personaId,
          actorType: "persona",
        })
        await OutboxRepository.insert(db, "agent_session:completed", {
          workspaceId,
          streamId,
          event: streamEvent,
        })
      })
    } catch (err) {
      logger.error({ err, sessionId: session.id }, "Failed to complete session, orphan cleanup will recover")
      throw err
    }

    logger.info({ sessionId: session.id, messagesSent, sentMessageIds }, "Session completed")

    return {
      status: "completed" as const,
      sessionId: session.id,
      messagesSent,
      sentMessageIds,
      lastSeenSequence,
    }
  } catch (err) {
    logger.error({ err, sessionId: session.id }, "Session failed")

    // Phase 3 (error): Mark session as failed + emit failed event atomically
    await withTransaction(pool, async (db) => {
      const failed = await AgentSessionRepository.updateStatus(db, session.id, SessionStatuses.FAILED, {
        error: String(err),
      })
      if (failed) {
        const steps = await AgentSessionRepository.findStepsBySession(db, session.id)

        const streamEvent = await StreamEventRepository.insert(db, {
          id: eventId(),
          streamId,
          eventType: "agent_session:failed",
          payload: {
            sessionId: session.id,
            stepCount: steps.length,
            error: String(err),
            traceId: session.id,
            failedAt: new Date().toISOString(),
          },
          actorId: personaId,
          actorType: "persona",
        })
        await OutboxRepository.insert(db, "agent_session:failed", {
          workspaceId,
          streamId,
          event: streamEvent,
        })
      }
    }).catch((e) => logger.error({ err: e }, "Failed to mark session as failed"))

    return { status: "failed" as const, sessionId: session.id }
  } finally {
    if (heartbeatInterval) clearInterval(heartbeatInterval)
  }
}

/**
 * Dependencies required to construct a PersonaAgent.
 */
export interface PersonaAgentDeps {
  pool: Pool
  traceEmitter: TraceEmitter
  responseGenerator: ResponseGenerator
  userPreferencesService: UserPreferencesService
  /** Researcher for workspace knowledge retrieval */
  researcher: Researcher
  /** Search service for workspace search tools */
  searchService: SearchService
  /** Rolling conversation summary state for long-context continuity */
  conversationSummaryService: ConversationSummaryService
  /** Storage provider for loading attachments */
  storage: StorageProvider
  /** Model registry for checking vision capabilities */
  modelRegistry: ModelRegistry
  createMessage: (params: {
    workspaceId: string
    streamId: string
    authorId: string
    authorType: AuthorType
    content: string
    sources?: SourceItem[]
    sessionId?: string
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
  trigger?: typeof AgentTriggers.MENTION // undefined = companion mode
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
  /** Last sequence processed - used to check for unseen messages after completion */
  lastSeenSequence?: bigint
  /** Stream ID - needed for follow-up job dispatch */
  streamId?: string
  /** Persona ID - needed for follow-up job dispatch */
  personaId?: string
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
    const {
      pool,
      responseGenerator,
      userPreferencesService,
      researcher,
      searchService,
      conversationSummaryService,
      storage,
      modelRegistry,
      createMessage,
      createThread,
    } = this.deps
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

    // Create trace emitter for session-room notifications
    const { traceEmitter } = this.deps

    // For channel mentions: create thread eagerly so session lifecycle events
    // go to the thread (where the session card will be visible)
    const isChannelMention = trigger === AgentTriggers.MENTION && stream.type === StreamTypes.CHANNEL
    let sessionStreamId = streamId
    let channelStreamId: string | undefined
    if (isChannelMention) {
      const thread = await createThread({
        workspaceId,
        parentStreamId: streamId,
        parentMessageId: messageId,
        createdBy: persona.id,
      })
      sessionStreamId = thread.id
      channelStreamId = streamId
      logger.info({ threadId: thread.id, streamId, messageId }, "Created thread for channel mention (eager)")
    }

    // Step 2: Run with session lifecycle management
    const result = await withSession(
      {
        pool,
        triggerMessageId: messageId,
        streamId: sessionStreamId,
        personaId: persona.id,
        personaName: persona.name,
        workspaceId,
        serverId,
        initialSequence: isChannelMention ? BigInt(0) : initialSequence,
      },
      async (session, db) => {
        // Create trace handle early so we can notify channel immediately
        const trace = this.deps.traceEmitter.forSession({
          sessionId: session.id,
          workspaceId,
          streamId: sessionStreamId,
          triggerMessageId: messageId,
          personaName: persona.name,
          channelStreamId,
        })
        trace.notifyActivityStarted()

        // Fetch trigger message to get the invoking member
        // Note: db is Pool here - repos accept Querier which Pool satisfies
        const triggerMessage = await MessageRepository.findById(db, messageId)
        const invokingMemberId = triggerMessage?.authorType === "member" ? triggerMessage.authorId : undefined

        // Fetch user preferences if we have an invoking member
        let preferences: UserPreferences | undefined
        if (invokingMemberId) {
          preferences = await userPreferencesService.getPreferences(workspaceId, invokingMemberId)
        }

        // Await attachment processing for all attachments on trigger message before proceeding
        // This ensures the agent can access extracted content from images, PDFs, Word docs, etc.
        if (triggerMessage) {
          const triggerAttachments = await AttachmentRepository.findByMessageId(db, messageId)
          const attachmentIds = triggerAttachments.map((a) => a.id)

          if (attachmentIds.length > 0) {
            logger.info(
              { messageId, attachmentCount: attachmentIds.length },
              "Awaiting attachment processing for trigger message"
            )
            const awaitResult = await awaitAttachmentProcessing(pool, attachmentIds)
            logger.info(
              {
                messageId,
                completedCount: awaitResult.completedIds.length,
                failedCount: awaitResult.failedOrTimedOutIds.length,
              },
              "Attachment processing await completed"
            )
          }
        }

        // Build stream context with temporal information and attachment context
        // Images are NOT loaded inline - agent sees captions from extractions
        // and can use load_attachment tool when it needs to see actual image content
        const context = await buildStreamContext(db, stream, {
          preferences,
          triggerMessageId: messageId,
          includeAttachments: true,
          // Don't pass storage/loadImages - agent uses load_attachment tool for images
        })

        const streamScopedMessages = context.conversationHistory.filter((m) => m.streamId === stream.id)
        const rollingConversationSummary = await conversationSummaryService.updateForContext({
          db,
          workspaceId,
          streamId: stream.id,
          personaId: persona.id,
          keptMessages: streamScopedMessages,
        })

        // Build a map of author IDs to names for message attribution
        // We need to look up both users and personas from the conversation history
        const authorNames = new Map<string, string>()

        // Start with participants (if available - channels/DMs have these)
        if (context.participants) {
          for (const p of context.participants) {
            authorNames.set(p.id, p.name)
          }
        }

        // Look up any member authors not already in participants (e.g., scratchpad owner)
        const memberAuthorIds = [
          ...new Set(
            context.conversationHistory
              .filter((m) => m.authorType === "member" && !authorNames.has(m.authorId))
              .map((m) => m.authorId)
          ),
        ]
        if (memberAuthorIds.length > 0) {
          const members = await MemberRepository.findByIds(db, memberAuthorIds)
          for (const m of members) {
            authorNames.set(m.id, m.name)
          }
        }

        // Look up persona names for any persona messages in history
        const personaAuthorIds = [
          ...new Set(context.conversationHistory.filter((m) => m.authorType === "persona").map((m) => m.authorId)),
        ]
        if (personaAuthorIds.length > 0) {
          const personas = await PersonaRepository.findByIds(db, personaAuthorIds)
          for (const p of personas) {
            authorNames.set(p.id, p.name)
          }
        }

        // Record the initial context - messages being processed at session start
        // This helps users understand WHY this session was triggered and WHAT the agent saw
        if (context.conversationHistory.length > 0) {
          // Find messages we're actually processing (recent ones, focused on trigger)
          // Include the trigger message and any recent context (last few messages)
          const triggerIdx = context.conversationHistory.findIndex((m) => m.id === messageId)
          const contextMessages =
            triggerIdx >= 0
              ? context.conversationHistory.slice(Math.max(0, triggerIdx - 4)) // 4 messages before + trigger
              : context.conversationHistory.slice(-5) // Fallback: last 5

          const step = await trace.startStep({
            stepType: "context_received",
            content: JSON.stringify({
              messages: contextMessages.map((m) => ({
                messageId: m.id,
                authorName: authorNames.get(m.authorId) ?? "Unknown",
                authorType: m.authorType,
                createdAt: m.createdAt.toISOString(),
                content: m.contentMarkdown.slice(0, 300), // Preview
                isTrigger: m.id === messageId,
              })),
            }),
          })
          await step.complete({})
        }

        // Look up mentioner name if this is a mention trigger
        let mentionerName: string | undefined
        if (trigger === AgentTriggers.MENTION && triggerMessage?.authorType === "member") {
          const mentioner = await MemberRepository.findById(db, triggerMessage.authorId)
          mentionerName = mentioner?.name ?? undefined
        }

        // Create researcher callback for on-demand workspace research tool
        let runResearcher: (() => Promise<ResearcherResult>) | undefined
        if (triggerMessage && invokingMemberId) {
          // Capture DM participant IDs if needed
          let dmParticipantIds: string[] | undefined
          if (stream.type === StreamTypes.DM) {
            const members = await StreamMemberRepository.list(db, { streamId })
            dmParticipantIds = members.map((m) => m.memberId)
          }

          runResearcher = () =>
            researcher.research({
              workspaceId,
              streamId,
              triggerMessage,
              conversationHistory: context.conversationHistory,
              invokingMemberId,
              dmParticipantIds,
            })
        }

        // Build system prompt with stream context and trigger info.
        // Retrieved knowledge is injected when the model calls workspace_research.
        const systemPrompt = buildSystemPrompt(
          persona,
          context,
          trigger,
          mentionerName,
          rollingConversationSummary,
          Boolean(runResearcher)
        )

        // For channel mentions the thread was already created eagerly before withSession.
        // Messages always go to sessionStreamId (thread for channels, original stream otherwise).
        const targetStreamId = sessionStreamId

        const doSendMessage = async (msgInput: SendMessageInputWithSources): Promise<SendMessageResult> => {
          const message = await createMessage({
            workspaceId,
            streamId: targetStreamId,
            authorId: persona.id,
            authorType: AuthorTypes.PERSONA,
            content: msgInput.content,
            sources: msgInput.sources,
            sessionId: session.id,
          })
          return { messageId: message.id, content: msgInput.content }
        }

        // Build search callbacks for workspace search tools
        // Compute accessible stream IDs once for both search and attachment tools
        let searchCallbacks: SearchToolsCallbacks | undefined
        let accessibleStreamIds: string[] | undefined
        if (invokingMemberId) {
          // Compute access spec for search context
          const accessSpec = await computeAgentAccessSpec(db, {
            stream,
            invokingMemberId,
          })

          // Get accessible stream IDs for the agent's context
          accessibleStreamIds = await SearchRepository.getAccessibleStreamsForAgent(db, accessSpec, workspaceId)
          // Capture in const for TypeScript narrowing inside callbacks
          const streamIdsForCallbacks = accessibleStreamIds

          searchCallbacks = {
            searchMessages: async (input) => {
              // Resolve optional stream filter
              let filterStreamIds = streamIdsForCallbacks
              if (input.stream) {
                const resolved = await resolveStreamIdentifier(db, workspaceId, input.stream, streamIdsForCallbacks)
                if (!resolved.resolved) {
                  // Stream not found or not accessible - return empty results
                  return []
                }
                filterStreamIds = [resolved.id]
              }

              const results = await searchService.search({
                workspaceId,
                memberId: invokingMemberId,
                query: input.query,
                filters: { streamIds: filterStreamIds },
                limit: 10,
                exact: input.exact,
              })

              // Enrich with author and stream names, then map to MessageSearchResult
              const enriched = await enrichMessageSearchResults(db, results)
              return enriched.map((r) => ({
                id: r.id,
                content: r.content,
                authorName: r.authorName,
                streamName: r.streamName,
                createdAt: r.createdAt.toISOString(),
              }))
            },

            searchStreams: async (input) => {
              // Use trigram search for fuzzy matching on stream names
              const streams = await StreamRepository.searchByName(db, {
                streamIds: streamIdsForCallbacks,
                query: input.query,
                types: input.types,
                limit: 10,
              })

              return streams.map((s) => ({
                id: s.id,
                type: s.type,
                name: s.displayName ?? s.slug ?? null,
                description: s.description ?? null,
              }))
            },

            searchUsers: async (input) => {
              const members = await MemberRepository.searchByNameOrSlug(db, workspaceId, input.query, 10)
              return members.map((m) => ({
                id: m.id,
                name: m.name,
                email: m.email,
              }))
            },

            getStreamMessages: async (input) => {
              // Resolve the stream identifier (ID, slug, or #slug)
              const resolved = await resolveStreamIdentifier(db, workspaceId, input.stream, streamIdsForCallbacks)
              if (!resolved.resolved) {
                // Stream not found or not accessible
                return []
              }

              // Get recent messages from the stream (returns newest first)
              const messages = await MessageRepository.list(db, resolved.id, {
                limit: input.limit ?? 10,
              })

              // Reverse to get chronological order (oldest first)
              messages.reverse()

              // Enrich with author names
              const memberIds = [...new Set(messages.filter((m) => m.authorType === "member").map((m) => m.authorId))]
              const personaIds = [...new Set(messages.filter((m) => m.authorType === "persona").map((m) => m.authorId))]

              const [members, personas] = await Promise.all([
                memberIds.length > 0 ? MemberRepository.findByIds(db, memberIds) : Promise.resolve([]),
                personaIds.length > 0 ? PersonaRepository.findByIds(db, personaIds) : Promise.resolve([]),
              ])

              const memberMap = new Map(members.map((m) => [m.id, m.name]))
              const personaMap = new Map(personas.map((p) => [p.id, p.name]))

              return messages.map((m) => ({
                id: m.id,
                content: m.contentMarkdown,
                authorName:
                  m.authorType === "member"
                    ? (memberMap.get(m.authorId) ?? "Unknown Member")
                    : (personaMap.get(m.authorId) ?? "Unknown Persona"),
                authorType: m.authorType,
                createdAt: m.createdAt.toISOString(),
              }))
            },
          }
        }

        // Build attachment callbacks for attachment tools
        // Reuses accessibleStreamIds computed above for search callbacks
        let attachmentCallbacks:
          | {
              search: SearchAttachmentsCallbacks
              get: GetAttachmentCallbacks
              load: LoadAttachmentCallbacks | undefined
              loadPdfSection: LoadPdfSectionCallbacks | undefined
              loadFileSection: LoadFileSectionCallbacks | undefined
              loadExcelSection: LoadExcelSectionCallbacks | undefined
            }
          | undefined
        if (invokingMemberId && accessibleStreamIds) {
          const searchAttachments: SearchAttachmentsCallbacks = {
            searchAttachments: async (input): Promise<AttachmentSearchResult[]> => {
              const results = await AttachmentRepository.searchWithExtractions(db, {
                workspaceId,
                streamIds: accessibleStreamIds,
                query: input.query,
                contentTypes: input.contentTypes as import("@threa/types").ExtractionContentType[] | undefined,
                limit: input.limit,
              })

              return results.map((r) => ({
                id: r.id,
                filename: r.filename,
                mimeType: r.mimeType,
                contentType: r.extraction?.contentType ?? null,
                summary: r.extraction?.summary ?? null,
                streamId: r.streamId,
                messageId: r.messageId,
                createdAt: r.createdAt.toISOString(),
              }))
            },
          }

          const getAttachment: GetAttachmentCallbacks = {
            getAttachment: async (input): Promise<AttachmentDetails | null> => {
              const attachment = await AttachmentRepository.findById(db, input.attachmentId)
              if (!attachment) return null

              // Check access: attachment must be in an accessible stream
              if (!attachment.streamId || !accessibleStreamIds.includes(attachment.streamId)) {
                return null
              }

              const extraction = await AttachmentExtractionRepository.findByAttachmentId(db, input.attachmentId)

              return {
                id: attachment.id,
                filename: attachment.filename,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
                processingStatus: attachment.processingStatus,
                createdAt: attachment.createdAt.toISOString(),
                extraction: extraction
                  ? {
                      contentType: extraction.contentType,
                      summary: extraction.summary,
                      fullText: extraction.fullText,
                      structuredData: extraction.structuredData,
                    }
                  : null,
              }
            },
          }

          // load_attachment is only available for vision-capable models
          let loadAttachment: LoadAttachmentCallbacks | undefined
          if (modelRegistry.supportsVision(persona.model)) {
            loadAttachment = {
              loadAttachment: async (input): Promise<LoadAttachmentResult | null> => {
                const attachment = await AttachmentRepository.findById(db, input.attachmentId)
                if (!attachment) return null

                // Check access
                if (!attachment.streamId || !accessibleStreamIds.includes(attachment.streamId)) {
                  return null
                }

                // Only allow loading images
                if (!attachment.mimeType.startsWith("image/")) {
                  return null
                }

                // Load the image data from storage
                const buffer = await storage.getObject(attachment.storagePath)
                const base64 = buffer.toString("base64")
                const dataUrl = `data:${attachment.mimeType};base64,${base64}`

                return {
                  id: attachment.id,
                  filename: attachment.filename,
                  mimeType: attachment.mimeType,
                  dataUrl,
                }
              },
            }
          }

          // load_pdf_section for loading page ranges from large PDFs
          const loadPdfSection: LoadPdfSectionCallbacks = {
            loadPdfSection: async (input): Promise<LoadPdfSectionResult | null> => {
              const attachment = await AttachmentRepository.findById(db, input.attachmentId)
              if (!attachment) return null

              // Check access
              if (!attachment.streamId || !accessibleStreamIds.includes(attachment.streamId)) {
                return null
              }

              // Get extraction to check metadata
              const extraction = await AttachmentExtractionRepository.findByAttachmentId(db, input.attachmentId)
              if (!extraction || extraction.sourceType !== "pdf" || !extraction.pdfMetadata) {
                return null
              }

              const totalPages = extraction.pdfMetadata.totalPages

              // Validate page range
              if (input.startPage > totalPages || input.endPage > totalPages) {
                return null
              }

              // Get page extractions for the range
              const pages = await PdfPageExtractionRepository.findByAttachmentAndPageRange(
                db,
                input.attachmentId,
                input.startPage,
                input.endPage
              )

              const pageContents = pages.map((p) => ({
                pageNumber: p.pageNumber,
                content: p.markdownContent ?? p.ocrText ?? p.rawText ?? "",
              }))

              const combinedContent = pageContents.map((p) => p.content).join("\n\n---\n\n")

              return {
                attachmentId: input.attachmentId,
                filename: attachment.filename,
                startPage: input.startPage,
                endPage: input.endPage,
                totalPages,
                content: combinedContent,
                pages: pageContents,
              }
            },
          }

          // load_file_section for loading line ranges from large text files
          const loadFileSection: LoadFileSectionCallbacks = {
            loadFileSection: async (input): Promise<LoadFileSectionResult | null> => {
              const attachment = await AttachmentRepository.findById(db, input.attachmentId)
              if (!attachment) return null

              // Check access
              if (!attachment.streamId || !accessibleStreamIds.includes(attachment.streamId)) {
                return null
              }

              // Get extraction to check metadata
              const extraction = await AttachmentExtractionRepository.findByAttachmentId(db, input.attachmentId)
              if (!extraction || extraction.sourceType !== "text" || !extraction.textMetadata) {
                return null
              }

              const totalLines = extraction.textMetadata.totalLines

              // Validate line range
              if (input.startLine >= totalLines || input.endLine > totalLines) {
                return null
              }

              // Fetch file from storage and extract requested lines
              const fileBuffer = await storage.getObject(attachment.storagePath)
              const text = fileBuffer.toString("utf-8")
              const lines = text.split("\n")

              const selectedLines = lines.slice(input.startLine, input.endLine)
              const content = selectedLines.join("\n")

              return {
                attachmentId: input.attachmentId,
                filename: attachment.filename,
                startLine: input.startLine,
                endLine: input.endLine,
                totalLines,
                content,
              }
            },
          }

          // load_excel_section for loading row ranges from large Excel workbooks
          const loadExcelSection: LoadExcelSectionCallbacks = {
            loadExcelSection: async (input): Promise<LoadExcelSectionResult | null> => {
              const attachment = await AttachmentRepository.findById(db, input.attachmentId)
              if (!attachment) return null

              // Check access
              if (!attachment.streamId || !accessibleStreamIds.includes(attachment.streamId)) {
                return null
              }

              // Get extraction to check metadata
              const extraction = await AttachmentExtractionRepository.findByAttachmentId(db, input.attachmentId)
              if (!extraction || extraction.sourceType !== "excel" || !extraction.excelMetadata) {
                return null
              }

              // Find the requested sheet in metadata
              const sheetInfo = extraction.excelMetadata.sheets.find((s) => s.name === input.sheetName)
              if (!sheetInfo) {
                return null
              }

              const { EXCEL_MAX_ROWS_PER_REQUEST } = await import("../attachments/excel/config")
              const startRow = input.startRow ?? 0
              const endRow = Math.min(input.endRow ?? sheetInfo.rows, startRow + EXCEL_MAX_ROWS_PER_REQUEST)

              // Validate row range
              if (startRow >= sheetInfo.rows || endRow > sheetInfo.rows) {
                return null
              }

              // Fetch file from storage and extract requested rows using SheetJS
              const { extractExcel } = await import("../attachments/excel/extractor")
              const { validateExcelFormat } = await import("../attachments/excel/detector")
              const fileBuffer = await storage.getObject(attachment.storagePath)
              const format = validateExcelFormat(fileBuffer)
              const extracted = extractExcel(fileBuffer, format)

              const sheet = extracted.sheets.find((s) => s.name === input.sheetName)
              if (!sheet) {
                return null
              }

              // Build markdown table for the requested row range
              const selectedRows = sheet.data.slice(startRow, endRow)
              const headerRow = `| ${sheet.headers.join(" | ")} |`
              const separator = `| ${sheet.headers.map(() => "---").join(" | ")} |`
              const dataRows = selectedRows.map((row) => `| ${row.join(" | ")} |`).join("\n")
              const content = `${headerRow}\n${separator}\n${dataRows}`

              return {
                attachmentId: input.attachmentId,
                filename: attachment.filename,
                sheetName: input.sheetName,
                startRow,
                endRow,
                totalRows: sheet.rows,
                headers: sheet.headers,
                content,
              }
            },
          }

          attachmentCallbacks = {
            search: searchAttachments,
            get: getAttachment,
            load: loadAttachment,
            loadPdfSection,
            loadFileSection,
            loadExcelSection,
          }
        }

        // Create callbacks for the response generator
        // Note: These use db (Pool) directly - each call auto-acquires/releases connection
        const callbacks: ResponseGeneratorCallbacks = {
          sendMessage: doSendMessage,
          sendMessageWithSources: doSendMessage,

          checkNewMessages: async (checkStreamId: string, sinceSequence: bigint, excludeAuthorId: string) => {
            const messages = await MessageRepository.listSince(db, checkStreamId, sinceSequence, {
              excludeAuthorId,
            })

            // Look up author names for rich trace display
            const memberIds = [...new Set(messages.filter((m) => m.authorType === "member").map((m) => m.authorId))]
            const personaIds = [...new Set(messages.filter((m) => m.authorType === "persona").map((m) => m.authorId))]

            const [members, personas] = await Promise.all([
              memberIds.length > 0 ? MemberRepository.findByIds(db, memberIds) : Promise.resolve([]),
              personaIds.length > 0 ? PersonaRepository.findByIds(db, personaIds) : Promise.resolve([]),
            ])

            const authorNames = new Map<string, string>()
            for (const m of members) authorNames.set(m.id, m.name)
            for (const p of personas) authorNames.set(p.id, p.name)

            return messages.map((m) => ({
              sequence: m.sequence,
              messageId: m.id,
              content: m.contentMarkdown,
              authorId: m.authorId,
              authorName: authorNames.get(m.authorId) ?? "Unknown",
              authorType: m.authorType,
              createdAt: m.createdAt.toISOString(),
            }))
          },

          updateLastSeenSequence: async (updateSessionId: string, sequence: bigint) => {
            await AgentSessionRepository.updateLastSeenSequence(db, updateSessionId, sequence)
          },

          search: searchCallbacks,

          attachments: attachmentCallbacks,

          awaitAttachmentProcessing: async (messageIds: string[]) => {
            // Get attachments for these messages and await their processing
            const attachmentsByMessage = await AttachmentRepository.findByMessageIds(db, messageIds)
            const allAttachmentIds: string[] = []
            for (const attachments of attachmentsByMessage.values()) {
              for (const a of attachments) {
                allAttachmentIds.push(a.id)
              }
            }
            if (allAttachmentIds.length > 0) {
              await awaitAttachmentProcessing(db, allAttachmentIds)
            }
          },

          recordStep: async (params: RecordStepParams) => {
            const step = await trace.startStep({
              stepType: params.stepType,
              content: params.content,
            })
            await step.complete({
              content: params.content,
              sources: params.sources,
              messageId: params.messageId,
              durationMs: params.durationMs,
            })
          },
        }

        // Format messages with timestamps if temporal context is available
        const formattedMessages = formatMessagesWithTemporal(context.conversationHistory, context)

        // Generate response - this is the long-running AI call
        // No database connection is held during this operation
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
            workspaceId, // For cost tracking
            invokingMemberId, // For cost attribution to the human user
            runResearcher,
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

    // Notify session room about terminal status (for trace dialog real-time updates)
    // Also notify channel room about activity ending (for inline indicator cleanup)
    if (result.status === "completed" || result.status === "failed") {
      const trace = traceEmitter.forSession({
        sessionId: result.sessionId,
        workspaceId,
        streamId: sessionStreamId,
        triggerMessageId: messageId,
        personaName: persona.name,
        channelStreamId,
      })
      if (result.status === "completed") {
        trace.notifyCompleted()
      } else {
        trace.notifyFailed()
      }
      trace.notifyActivityEnded()
    }

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
          lastSeenSequence: result.lastSeenSequence,
          streamId,
          personaId,
        }
    }
  }
}
