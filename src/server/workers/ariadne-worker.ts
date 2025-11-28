import { Pool } from "pg"
import { sql } from "../lib/db"
import { getJobQueue, RespondJobData, JobPriority } from "../lib/job-queue"
import { invokeAriadne, AriadneContext, ConversationMessage } from "../ai/ariadne/agent"
import { AIUsageService } from "../services/ai-usage-service"
import { StreamService } from "../services/stream-service"
import { logger } from "../lib/logger"
import { Models, calculateCost } from "../lib/ai-providers"
import type { AriadneTrigger } from "./ariadne-trigger"

const ARIADNE_PERSONA_ID = "pers_default_ariadne"
const CHANNEL_CONTEXT_MESSAGES = 10

/**
 * Ariadne Worker - Processes AI response jobs.
 *
 * Listens for ai.respond jobs from the queue and generates responses
 * using the Ariadne agent. Handles budget checking, context fetching,
 * and response posting.
 */
export class AriadneWorker {
  private usageService: AIUsageService
  private streamService: StreamService
  private isRunning = false

  constructor(
    private pool: Pool,
    private ariadneTrigger: AriadneTrigger,
  ) {
    this.usageService = new AIUsageService(pool)
    this.streamService = new StreamService(pool)
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

    try {
      // Check if AI is enabled for this workspace
      const isEnabled = await this.usageService.isAIEnabled(workspaceId)
      if (!isEnabled) {
        logger.info({ workspaceId }, "AI not enabled for workspace, skipping Ariadne response")
        return
      }

      // Check monthly budget
      const usage = await this.usageService.getMonthlyUsage(workspaceId)
      const budget = await this.usageService.getWorkspaceBudget(workspaceId)
      if (usage.totalCostCents >= budget) {
        logger.warn({ workspaceId, usage: usage.totalCostCents, budget }, "Workspace AI budget exceeded")
        await this.postResponse(
          streamId,
          "I'm sorry, but the workspace's AI budget for this month has been reached. Please contact your workspace admin to increase the budget.",
        )
        return
      }

      // Get user info for context
      const userResult = await this.pool.query<{ name: string; email: string }>(
        sql`SELECT COALESCE(wp.display_name, u.name) as name, u.email
            FROM users u
            LEFT JOIN workspace_profiles wp ON u.id = wp.user_id AND wp.workspace_id = ${workspaceId}
            WHERE u.id = ${mentionedBy}`,
      )
      const mentionedByName = userResult.rows[0]?.name || userResult.rows[0]?.email || "someone"

      // Get stream type to determine context strategy
      const stream = await this.streamService.getStream(streamId)
      const streamType = stream?.streamType || "channel"

      // Fetch conversation history based on stream type
      const conversationHistory = await this.fetchConversationContext(streamId, eventId, streamType)

      const context: AriadneContext = {
        workspaceId,
        streamId,
        mentionedBy,
        mentionedByName,
        mode: mode || "retrieval",
        conversationHistory,
      }

      logger.info(
        {
          job: job.id,
          streamId,
          mentionedBy: mentionedByName,
          mode: mode || "retrieval",
          historyMessages: conversationHistory.length,
        },
        "Processing Ariadne request",
      )

      // Invoke Ariadne
      const result = await invokeAriadne(this.pool, context, question)

      // Track usage
      const costCents = calculateCost(Models.CLAUDE_HAIKU, result.usage)
      await this.usageService.trackUsage({
        workspaceId,
        userId: mentionedBy,
        jobType: "respond",
        model: Models.CLAUDE_HAIKU,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costCents,
        streamId,
        eventId,
        jobId: job.id,
      })

      // Determine where to post the response
      let responseStreamId = streamId

      // For retrieval mode (channel @mentions), respond in a thread
      if (mode !== "thinking_partner") {
        const currentStream = await this.streamService.getStream(streamId)
        if (currentStream && currentStream.streamType === "channel") {
          const { stream: thread } = await this.streamService.createThreadFromEvent(eventId, ARIADNE_PERSONA_ID)
          responseStreamId = thread.id
          logger.info({ eventId, threadId: thread.id }, "Ariadne responding in thread")
        }
      }

      // Post the response
      await this.postResponse(responseStreamId, result.response)

      // Reset engagement tracking - Ariadne is back in the conversation
      await this.ariadneTrigger.resetEngagementTracking(responseStreamId)

      logger.info({ job: job.id, responseLength: result.response.length, costCents }, "Ariadne response posted")
    } catch (err) {
      logger.error({ err, job: job.id }, "Ariadne worker failed to process job")

      try {
        await this.postResponse(streamId, "I encountered an error while processing your request. Please try again.")
      } catch {
        // Ignore posting errors
      }

      throw err
    }
  }

  private async postResponse(streamId: string, content: string): Promise<void> {
    await this.streamService.createEvent({
      streamId,
      agentId: ARIADNE_PERSONA_ID,
      eventType: "message",
      content,
      mentions: [],
    })
  }

  /**
   * Fetch conversation history for context.
   * - Thinking spaces: All messages in the stream
   * - Threads: Full thread history
   * - Channels: Surrounding N messages around the triggering event
   */
  private async fetchConversationContext(
    streamId: string,
    eventId: string,
    streamType: string,
  ): Promise<ConversationMessage[]> {
    const conversationHistory: ConversationMessage[] = []

    try {
      if (streamType === "thinking_space" || streamType === "thread") {
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
      } else {
        const eventResult = await this.pool.query<{ created_at: Date }>(
          sql`SELECT created_at FROM stream_events WHERE id = ${eventId}`,
        )
        const eventTimestamp = eventResult.rows[0]?.created_at

        if (eventTimestamp) {
          const beforeEvents = await this.pool.query<{
            id: string
            content: string
            actor_id: string | null
            agent_id: string | null
            actor_name: string | null
            actor_email: string | null
          }>(
            sql`SELECT e.id, tm.content, e.actor_id, e.agent_id,
                       COALESCE(wp.display_name, u.name) as actor_name, u.email as actor_email
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
                LIMIT ${Math.floor(CHANNEL_CONTEXT_MESSAGES / 2)}`,
          )

          for (const event of beforeEvents.rows.reverse()) {
            if (!event.content) continue
            const isAriadne = event.agent_id === ARIADNE_PERSONA_ID
            conversationHistory.push({
              role: isAriadne ? "assistant" : "user",
              name: isAriadne ? "Ariadne" : event.actor_name || event.actor_email || "User",
              content: event.content,
            })
          }
        }
      }

      logger.debug({ streamId, eventId, streamType, historyCount: conversationHistory.length }, "Fetched conversation context")
    } catch (err) {
      logger.error({ err, streamId, eventId }, "Failed to fetch conversation context")
    }

    return conversationHistory
  }
}

/**
 * Queue an Ariadne response job when @ariadne is mentioned.
 */
export async function queueAriadneResponse(params: {
  workspaceId: string
  streamId: string
  eventId: string
  mentionedBy: string
  question: string
}): Promise<string | null> {
  const boss = getJobQueue()

  return await boss.send("ai.respond", params, {
    priority: JobPriority.URGENT,
    retryLimit: 2,
    retryDelay: 10,
    expireInSeconds: 300,
  })
}
