import { Pool } from "pg"
import { sql } from "../lib/db"
import { getJobQueue, RespondJobData } from "../lib/job-queue"
import { invokeAriadne, streamAriadne, AriadneContext, ConversationMessage, StreamContext } from "../ai/ariadne/agent"
import { AriadneResearcher, classifyQuestionComplexity, Citation } from "../ai/ariadne/researcher"
import { AIUsageService } from "../services/ai-usage-service"
import { StreamService } from "../services/stream-service"
import { MemoService } from "../services/memo-service"
import { AgentSessionService, SessionStep } from "../services/agent-session-service"
import { logger } from "../lib/logger"
import { Models, calculateCost } from "../lib/ai-providers"
import { emitSessionStarted, emitSessionStep, emitSessionCompleted } from "../lib/ephemeral-events"
import { scoreHelpfulness } from "../lib/ollama"
import { Langfuse } from "langfuse"
import { LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_BASE_URL } from "../config"
import type { AriadneTrigger } from "./ariadne-trigger"
import type { SearchScope } from "../services/search-service"

// Initialize Langfuse client for scoring
const langfuse =
  LANGFUSE_SECRET_KEY && LANGFUSE_PUBLIC_KEY
    ? new Langfuse({
        secretKey: LANGFUSE_SECRET_KEY,
        publicKey: LANGFUSE_PUBLIC_KEY,
        baseUrl: LANGFUSE_BASE_URL,
      })
    : null

const ARIADNE_PERSONA_ID = "pers_default_ariadne"
const CHANNEL_CONTEXT_MESSAGES = 10

/**
 * Ariadne Worker - Processes AI response jobs.
 *
 * Listens for ai.respond jobs from the queue and generates responses
 * using the Ariadne agent. Handles budget checking, context fetching,
 * session tracking, and response posting.
 */
export class AriadneWorker {
  private usageService: AIUsageService
  private streamService: StreamService
  private memoService: MemoService
  private sessionService: AgentSessionService
  private isRunning = false

  constructor(
    private pool: Pool,
    private ariadneTrigger: AriadneTrigger,
  ) {
    this.usageService = new AIUsageService(pool)
    this.streamService = new StreamService(pool)
    this.memoService = new MemoService(pool)
    this.sessionService = new AgentSessionService(pool)
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Ariadne worker already running")
      return
    }

    logger.info("Starting Ariadne worker")

    const boss = getJobQueue()

    await boss.work<RespondJobData>(
      "ai.respond",
      {
        batchSize: 1,
        pollingIntervalSeconds: 2,
      },
      async (jobs) => {
        for (const job of jobs) {
          await this.processJob(job)
        }
      },
    )

    this.isRunning = true
    logger.info("Ariadne worker started")
  }

  private async processJob(job: { id: string; data: RespondJobData }): Promise<void> {
    const { workspaceId, streamId, eventId, mentionedBy, question, mode } = job.data

    // Determine where to respond - for channel @mentions in retrieval mode, respond in a thread
    // We determine this EARLY so the session is created in the right stream
    let responseStreamId = streamId
    const sourceStream = await this.streamService.getStream(streamId)

    if (mode !== "thinking_partner" && sourceStream?.streamType === "channel") {
      // Create thread for the response - the thinking UI will appear there
      const { stream: thread } = await this.streamService.createThreadFromEvent(eventId, ARIADNE_PERSONA_ID)
      responseStreamId = thread.id
      logger.info({ eventId, threadId: thread.id }, "Ariadne will respond in thread")
    }

    // Create or resume session in the response stream (thread or original stream)
    const { session, isNew } = await this.sessionService.createSession({
      workspaceId,
      streamId: responseStreamId,
      triggeringEventId: eventId,
    })

    // If session already completed or failed, don't retry
    if (!isNew && (session.status === "completed" || session.status === "failed")) {
      logger.info(
        { sessionId: session.id, status: session.status },
        "Session already completed/failed, skipping job",
      )
      return
    }

    // Only create thinking event for new sessions (not resumes)
    if (isNew) {
      // Create an agent_thinking event in the response stream
      // This flows through normal event infrastructure and shows up immediately
      await this.streamService.createEvent({
        streamId: responseStreamId,
        agentId: ARIADNE_PERSONA_ID,
        eventType: "agent_thinking",
        payload: {
          sessionId: session.id,
          triggeringEventId: eventId,
          status: "active",
        },
      })

      // Emit session:started to parent channel for the badge on the original message
      // and to the pending thread room (users viewing via eventId before thread was created)
      if (responseStreamId !== streamId) {
        await emitSessionStarted(workspaceId, streamId, session.id, eventId, responseStreamId)
        await emitSessionStarted(workspaceId, eventId, session.id, eventId, responseStreamId)
      }
    }

    // Helper to emit a step to all relevant rooms
    const emitStepToAllRooms = async (step: SessionStep) => {
      await emitSessionStep(workspaceId, responseStreamId, session.id, step)
      // Also emit to pending thread room (users viewing via eventId before thread was created)
      if (responseStreamId !== streamId) {
        await emitSessionStep(workspaceId, eventId, session.id, step)
      }
    }

    // Helper to add and emit a step
    const addStep = async (
      type: SessionStep["type"],
      content: string,
      options?: { toolName?: string; toolInput?: Record<string, unknown> },
    ): Promise<string> => {
      const stepId = await this.sessionService.addStep({
        sessionId: session.id,
        type,
        content,
        toolName: options?.toolName,
        toolInput: options?.toolInput,
      })

      // Get the full step for emitting
      const updatedSession = await this.sessionService.getSession(session.id)
      const step = updatedSession?.steps.find((s) => s.id === stepId)
      if (step) {
        await emitStepToAllRooms(step)
      }

      return stepId
    }

    // Helper to complete a step
    const completeStep = async (stepId: string, toolResult?: string, failed?: boolean): Promise<void> => {
      await this.sessionService.completeStep({ sessionId: session.id, stepId, toolResult, failed })

      // Get and emit the updated step
      const updatedSession = await this.sessionService.getSession(session.id)
      const step = updatedSession?.steps.find((s) => s.id === stepId)
      if (step) {
        await emitStepToAllRooms(step)
      }
    }

    try {
      // Check if AI is enabled for this workspace
      const isEnabled = await this.usageService.isAIEnabled(workspaceId)
      if (!isEnabled) {
        logger.info({ workspaceId }, "AI not enabled for workspace, skipping Ariadne response")
        await this.sessionService.updateStatus(session.id, "failed", "AI not enabled for this workspace")
        await emitSessionCompleted(workspaceId, responseStreamId, session.id, "failed", {
          errorMessage: "AI not enabled for this workspace",
        })
        return
      }

      // Check monthly budget
      const usage = await this.usageService.getMonthlyUsage(workspaceId)
      const budget = await this.usageService.getWorkspaceBudget(workspaceId)
      if (usage.totalCostCents >= budget) {
        logger.warn({ workspaceId, usage: usage.totalCostCents, budget }, "Workspace AI budget exceeded")
        await this.sessionService.updateStatus(session.id, "failed", "Budget exceeded")
        await emitSessionCompleted(workspaceId, responseStreamId, session.id, "failed", {
          errorMessage: "Budget exceeded",
        })
        await this.postResponse(
          responseStreamId,
          "I'm sorry, but the workspace's AI budget for this month has been reached. Please contact your workspace admin to increase the budget.",
        )
        return
      }

      // Step: Gathering context
      const contextStepId = await addStep("gathering_context", "Gathering context...")

      // Get user info for context
      const userResult = await this.pool.query<{ name: string; email: string }>(
        sql`SELECT COALESCE(wp.display_name, u.name) as name, u.email
            FROM users u
            LEFT JOIN workspace_profiles wp ON u.id = wp.user_id AND wp.workspace_id = ${workspaceId}
            WHERE u.id = ${mentionedBy}`,
      )
      const mentionedByName = userResult.rows[0]?.name || userResult.rows[0]?.email || "someone"

      // Get stream info to determine context strategy and search scope
      const stream = await this.streamService.getStream(streamId)
      const streamType = stream?.streamType || "channel"
      const streamVisibility = stream?.visibility || "public"

      // Fetch context based on stream type
      const isChannel = streamType === "channel"
      const conversationHistory = isChannel ? [] : await this.fetchConversationHistory(streamId, eventId)
      const backgroundContext = isChannel ? await this.fetchBackgroundContext(streamId, eventId) : undefined

      // Fetch stream context (members, topic, parent stream)
      const streamContext = await this.fetchStreamContext(streamId, stream)

      const context: AriadneContext = {
        workspaceId,
        streamId,
        mentionedBy,
        mentionedByName,
        mode: mode || "retrieval",
        streamType: streamType as AriadneContext["streamType"],
        streamVisibility: streamVisibility as AriadneContext["streamVisibility"],
        conversationHistory,
        backgroundContext,
        streamContext,
      }

      // Complete context gathering step
      const memberCount = streamContext?.members.length || 0
      const parentInfo = streamContext?.parentStream ? `, thread from #${streamContext.parentStream.name}` : ""
      await completeStep(
        contextStepId,
        `Found ${conversationHistory.length} messages, ${memberCount} participants${parentInfo}${backgroundContext ? ", plus channel context" : ""}`,
      )

      // Determine search scope from context
      const scope: SearchScope = this.determineSearchScope(streamType, streamVisibility, streamId)

      // Classify question complexity (for retrieval mode only)
      const isRetrievalMode = mode !== "thinking_partner"
      const complexity = isRetrievalMode ? await classifyQuestionComplexity(question) : "simple"

      logger.info(
        {
          job: job.id,
          sessionId: session.id,
          streamId,
          streamType,
          mentionedBy: mentionedByName,
          mode: mode || "retrieval",
          complexity,
          historyMessages: conversationHistory.length,
          hasBackgroundContext: !!backgroundContext,
        },
        "Processing Ariadne request",
      )

      let finalResponse = ""
      let citedEventIds: string[] = []
      let citationDetails: Citation[] = []
      let researcherIterations = 0

      // For complex retrieval questions, use the iterative researcher
      if (isRetrievalMode && complexity === "complex" && !conversationHistory.length) {
        // Step: Researching (iterative)
        const researchStepId = await addStep("reasoning", "Researching your question...")

        try {
          const researcher = new AriadneResearcher(this.pool, workspaceId, mentionedBy, scope)
          const result = await researcher.research(question)

          finalResponse = result.content
          citedEventIds = result.citations
          citationDetails = result.citationDetails
          researcherIterations = result.iterations

          await completeStep(researchStepId, `Found ${result.citations.length} relevant messages in ${result.iterations} iterations (confidence: ${(result.confidence * 100).toFixed(0)}%)`)
        } catch (err) {
          logger.warn({ err }, "Researcher failed, falling back to streaming agent")
          await completeStep(researchStepId, "Research failed, using standard approach", true)
          // Fall through to streaming agent below
        }
      }

      // If we don't have a response yet (simple question, thinking partner, or researcher failed), use streaming agent
      if (!finalResponse) {
        // Step: Reasoning (starts when we call the agent)
        const reasoningStepId = await addStep("reasoning", "Thinking...")

        // Use streaming to capture tool calls and track them as steps
        const activeToolSteps = new Map<string, string>() // tool content -> stepId

        for await (const chunk of streamAriadne(this.pool, context, question)) {
          if (chunk.type === "tool_call") {
            // Check if we already have a step for this tool call
            if (!activeToolSteps.has(chunk.content)) {
              // Create a new tool call step
              const toolStepId = await addStep("tool_call", chunk.content, {
                toolName: chunk.content.split(" ")[0], // Extract tool name from content like "search_messages: query"
              })
              activeToolSteps.set(chunk.content, toolStepId)
            }
          } else if (chunk.type === "token") {
            // Accumulate the final response
            finalResponse = chunk.content
          } else if (chunk.type === "done") {
            // Complete reasoning step
            await completeStep(reasoningStepId)

            // Complete any pending tool steps
            for (const [_content, stepId] of activeToolSteps) {
              await completeStep(stepId)
            }
          }
        }
      }

      // Step: Synthesizing (preparing response)
      const synthesizeStepId = await addStep("synthesizing", "Preparing response...")

      // Estimate token usage
      const inputTokens = Math.ceil(question.length / 4)
      const outputTokens = Math.ceil(finalResponse.length / 4)

      // Track usage
      const costCents = calculateCost(Models.CLAUDE_HAIKU, { inputTokens, outputTokens })
      await this.usageService.trackUsage({
        workspaceId,
        userId: mentionedBy,
        jobType: "respond",
        model: Models.CLAUDE_HAIKU,
        inputTokens,
        outputTokens,
        costCents,
        streamId,
        eventId,
        jobId: job.id,
      })

      // Post the response with citation details (responseStreamId was determined at the start)
      const responseEvent = await this.postResponse(responseStreamId, finalResponse, session.id, citationDetails)

      // Complete synthesize step
      await completeStep(synthesizeStepId, `Response: ${finalResponse.length} characters`)

      // Generate summary and complete the session
      await this.sessionService.updateStatus(session.id, "summarizing")
      const summary = await this.generateSummary(session.id)
      await this.sessionService.setSummary(session.id, summary)
      await this.sessionService.linkResponseEvent(session.id, responseEvent.id)
      await this.sessionService.updateStatus(session.id, "completed")

      // Emit session completed to the thread
      await emitSessionCompleted(workspaceId, responseStreamId, session.id, "completed", {
        summary,
        responseEventId: responseEvent.id,
      })

      // If this was a channel mention, also notify the parent channel and pending thread room
      if (responseStreamId !== streamId) {
        await emitSessionCompleted(workspaceId, streamId, session.id, "completed", {
          summary,
          responseEventId: responseEvent.id,
        })
        // Emit to pending thread room (users viewing the thread before it was created)
        // They join the room by eventId, not threadId
        await emitSessionCompleted(workspaceId, eventId, session.id, "completed", {
          summary,
          responseEventId: responseEvent.id,
        })
      }

      // Reset engagement tracking - Ariadne is back in the conversation
      await this.ariadneTrigger.resetEngagementTracking(responseStreamId)

      // Score helpfulness asynchronously (don't block the response)
      this.scoreAndLogHelpfulness(session.id, question, finalResponse, context, workspaceId).catch((err) => {
        logger.warn({ err, sessionId: session.id }, "Failed to score helpfulness")
      })

      // Auto-create memo from successful researcher answers (high confidence)
      if (researcherIterations > 0 && citedEventIds.length > 0) {
        this.memoService.createFromAriadneSuccess({
          workspaceId,
          query: question,
          citedEventIds,
          responseEventId: responseEvent.id,
          sessionId: session.id,
          streamId: responseStreamId,
        }).catch((err) => {
          logger.warn({ err, sessionId: session.id }, "Failed to auto-create memo")
        })
      }

      logger.info(
        { job: job.id, sessionId: session.id, responseLength: finalResponse.length, costCents },
        "Ariadne response posted",
      )
    } catch (err) {
      logger.error({ err, job: job.id, sessionId: session.id }, "Ariadne worker failed to process job")

      // Update session status to failed
      const errorMessage = err instanceof Error ? err.message : "Unknown error"
      await this.sessionService.updateStatus(session.id, "failed", errorMessage)
      await emitSessionCompleted(workspaceId, responseStreamId, session.id, "failed", { errorMessage })

      // If this was a channel mention, also notify the parent channel and pending thread room
      if (responseStreamId !== streamId) {
        await emitSessionCompleted(workspaceId, streamId, session.id, "failed", { errorMessage })
        // Emit to pending thread room (users viewing the thread before it was created)
        await emitSessionCompleted(workspaceId, eventId, session.id, "failed", { errorMessage })
      }

      try {
        await this.postResponse(responseStreamId, "I encountered an error while processing your request. Please try again.")
      } catch {
        // Ignore posting errors
      }

      throw err
    }
  }

  private async postResponse(
    streamId: string,
    content: string,
    sessionId?: string,
    citations?: Citation[],
  ): Promise<{ id: string }> {
    const payload: Record<string, unknown> = {}

    if (sessionId) {
      payload.sessionId = sessionId
    }

    if (citations && citations.length > 0) {
      payload.citations = citations
    }

    return await this.streamService.createEvent({
      streamId,
      agentId: ARIADNE_PERSONA_ID,
      eventType: "message",
      content,
      mentions: [],
      payload: Object.keys(payload).length > 0 ? payload : undefined,
    })
  }

  /**
   * Generate a summary of the session's steps using a fast model.
   */
  private async generateSummary(sessionId: string): Promise<string> {
    const session = await this.sessionService.getSession(sessionId)
    if (!session) return "Session completed."

    // Build a simple summary from the steps
    const stepDescriptions = session.steps
      .filter((s) => s.status === "completed")
      .map((s) => {
        switch (s.type) {
          case "gathering_context":
            return "gathered context"
          case "reasoning":
            return "analyzed the question"
          case "tool_call":
            return s.tool_name ? `used ${s.tool_name}` : "used a tool"
          case "synthesizing":
            return "prepared response"
          default:
            return s.type
        }
      })

    // Calculate duration
    const durationMs = session.completedAt
      ? new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime()
      : 0
    const durationSec = (durationMs / 1000).toFixed(1)

    // For now, generate a simple summary without calling the LLM
    // TODO: Optionally call haiku for a more natural summary
    const toolsUsed = session.steps.filter((s) => s.type === "tool_call" && s.tool_name).map((s) => s.tool_name)
    const uniqueTools = [...new Set(toolsUsed)]

    if (uniqueTools.length > 0) {
      return `Analyzed the question using ${uniqueTools.join(", ")} in ${durationSec}s.`
    } else {
      return `Thought about the question for ${durationSec}s.`
    }
  }

  /**
   * Fetch conversation history for threads and thinking spaces.
   * For threads, includes the root event that started the thread.
   */
  private async fetchConversationHistory(streamId: string, eventId: string): Promise<ConversationMessage[]> {
    const conversationHistory: ConversationMessage[] = []

    try {
      // Get the stream to check if it's a thread with a root event
      const stream = await this.streamService.getStream(streamId)

      // If this is a thread, fetch the root event first
      if (stream?.branchedFromEventId) {
        const rootEvent = await this.streamService.getEventWithDetails(stream.branchedFromEventId)
        if (rootEvent && rootEvent.content) {
          const isAriadne = rootEvent.agentId === ARIADNE_PERSONA_ID
          conversationHistory.push({
            role: isAriadne ? "assistant" : "user",
            name: isAriadne ? "Ariadne" : rootEvent.actorName || rootEvent.actorEmail || "User",
            content: rootEvent.content,
          })
        }
      }

      // Now get the thread's own events
      const events = await this.streamService.getStreamEvents(streamId, 50)

      for (const event of events) {
        if (event.eventType !== "message" || !event.content) continue
        if (event.id === eventId) continue

        const isAriadne = event.agentId === ARIADNE_PERSONA_ID
        conversationHistory.push({
          role: isAriadne ? "assistant" : "user",
          name: isAriadne ? "Ariadne" : event.actorName || event.actorEmail || "User",
          content: event.content,
        })
      }

      logger.debug({ streamId, eventId, historyCount: conversationHistory.length, hasRootEvent: !!stream?.branchedFromEventId }, "Fetched conversation history")
    } catch (err) {
      logger.error({ err, streamId, eventId }, "Failed to fetch conversation history")
    }

    return conversationHistory
  }

  /**
   * Fetch background context for channel invocations.
   */
  private async fetchBackgroundContext(streamId: string, eventId: string): Promise<string | undefined> {
    try {
      const eventResult = await this.pool.query<{ created_at: Date }>(
        sql`SELECT created_at FROM stream_events WHERE id = ${eventId}`,
      )
      const eventTimestamp = eventResult.rows[0]?.created_at
      if (!eventTimestamp) return undefined

      const recentEvents = await this.pool.query<{
        content: string
        actor_name: string | null
        actor_email: string | null
        agent_id: string | null
      }>(
        sql`SELECT tm.content,
                   COALESCE(wp.display_name, u.name) as actor_name, u.email as actor_email,
                   e.agent_id
            FROM stream_events e
            INNER JOIN streams s ON e.stream_id = s.id
            LEFT JOIN users u ON e.actor_id = u.id
            LEFT JOIN workspace_profiles wp ON wp.workspace_id = s.workspace_id AND wp.user_id = e.actor_id
            LEFT JOIN text_messages tm ON e.content_type = 'text_message' AND e.content_id = tm.id
            WHERE e.stream_id = ${streamId}
              AND e.event_type = 'message'
              AND e.deleted_at IS NULL
              AND e.created_at < ${eventTimestamp}
              AND e.id != ${eventId}
            ORDER BY e.created_at DESC
            LIMIT ${CHANNEL_CONTEXT_MESSAGES}`,
      )

      if (recentEvents.rows.length === 0) return undefined

      const contextLines = recentEvents.rows
        .reverse()
        .map((event) => {
          if (!event.content) return null
          const name =
            event.agent_id === ARIADNE_PERSONA_ID ? "Ariadne" : event.actor_name || event.actor_email || "User"
          return `[${name}]: ${event.content}`
        })
        .filter(Boolean)

      if (contextLines.length === 0) return undefined

      logger.debug({ streamId, eventId, contextLines: contextLines.length }, "Fetched background context")
      return contextLines.join("\n")
    } catch (err) {
      logger.error({ err, streamId, eventId }, "Failed to fetch background context")
      return undefined
    }
  }

  /**
   * Fetch stream context including members, topic, and parent stream info.
   */
  private async fetchStreamContext(
    streamId: string,
    stream: Awaited<ReturnType<StreamService["getStream"]>>,
  ): Promise<StreamContext | undefined> {
    try {
      if (!stream) return undefined

      // Get current stream members
      const members = await this.streamService.getStreamMembers(streamId)
      const memberList = members.map((m) => ({ name: m.name, email: m.email }))

      const streamContext: StreamContext = {
        streamName: stream.name || stream.slug || undefined,
        topic: stream.topic || undefined,
        description: stream.description || undefined,
        members: memberList,
      }

      // If this is a thread, get parent stream info
      if (stream.parentStreamId) {
        const parentStream = await this.streamService.getStream(stream.parentStreamId)
        if (parentStream) {
          const parentMembers = await this.streamService.getStreamMembers(stream.parentStreamId)
          streamContext.parentStream = {
            name: parentStream.name || parentStream.slug || "channel",
            topic: parentStream.topic || undefined,
            members: parentMembers.map((m) => ({ name: m.name, email: m.email })),
          }
        }
      }

      logger.debug(
        {
          streamId,
          memberCount: memberList.length,
          hasTopic: !!stream.topic,
          hasParent: !!streamContext.parentStream,
        },
        "Fetched stream context",
      )

      return streamContext
    } catch (err) {
      logger.error({ err, streamId }, "Failed to fetch stream context")
      return undefined
    }
  }

  /**
   * Determine the search scope based on stream type and visibility.
   */
  private determineSearchScope(streamType: string, streamVisibility: string, streamId: string): SearchScope {
    // Thinking spaces: full user access
    if (streamType === "thinking_space") {
      return { type: "user" }
    }

    // Private streams: current stream + public
    if (streamVisibility === "private") {
      return { type: "private", currentStreamId: streamId }
    }

    // Public streams: public only
    return { type: "public" }
  }

  /**
   * Score the helpfulness of Ariadne's response and log to Langfuse.
   * This runs asynchronously after the response is posted.
   */
  private async scoreAndLogHelpfulness(
    sessionId: string,
    question: string,
    response: string,
    context: AriadneContext,
    workspaceId: string,
  ): Promise<void> {
    try {
      // Build context string from conversation history
      const contextStr = context.conversationHistory
        ?.map((msg) => `[${msg.name}]: ${msg.content}`)
        .join("\n")
        .slice(0, 1000)

      // Score using the local SLM
      const result = await scoreHelpfulness(question, response, contextStr)

      logger.info(
        {
          sessionId,
          score: result.score,
          reasoning: result.reasoning,
          confident: result.confident,
          mode: context.mode,
        },
        "Helpfulness score",
      )

      // Log to Langfuse if available
      if (langfuse) {
        // Create a trace for the scoring
        const trace = langfuse.trace({
          name: "ariadne-helpfulness",
          sessionId: context.streamId,
          userId: context.mentionedBy,
          metadata: {
            workspaceId,
            sessionId,
            mode: context.mode,
            questionLength: question.length,
            responseLength: response.length,
          },
          tags: [
            "ariadne",
            context.mode || "retrieval",
            `helpfulness:${result.score}`,
            result.score >= 4 ? "helpful" : result.score <= 2 ? "unhelpful" : "neutral",
          ],
        })

        // Add a score to the trace
        trace.score({
          name: "helpfulness",
          value: result.score,
          comment: result.reasoning,
        })

        // Flush to ensure the score is sent
        await langfuse.flushAsync()
      }

      // Store the score in the session for future reference
      await this.sessionService.setHelpfulnessScore(sessionId, result.score, result.reasoning)
    } catch (err) {
      logger.error({ err, sessionId }, "Failed to score and log helpfulness")
    }
  }
}

// Re-export from ariadne-trigger for backwards compatibility
export { queueAriadneResponse } from "./ariadne-trigger"
