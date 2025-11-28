import { Pool } from "pg"
import { sql } from "../lib/db"
import { getJobQueue, RespondJobData, JobPriority } from "../lib/job-queue"
import { invokeAriadne, AriadneContext, ConversationMessage } from "../ai/ariadne/agent"
import { AIUsageService } from "../services/ai-usage-service"
import { StreamService } from "../services/stream-service"
import { logger } from "../lib/logger"
import { Models, calculateCost } from "../lib/ai-providers"
import { resetEngagementTracking } from "./ariadne-trigger"

const ARIADNE_PERSONA_ID = "pers_default_ariadne"
const CHANNEL_CONTEXT_MESSAGES = 10 // Number of surrounding messages for channel context

/**
 * Start the Ariadne response worker.
 * Processes ai.respond jobs when @ariadne is mentioned.
 */
export async function startAriadneWorker(pool: Pool): Promise<void> {
  const boss = getJobQueue()
  const usageService = new AIUsageService(pool)
  const streamService = new StreamService(pool)

  logger.info("Starting Ariadne worker")

  await boss.work<RespondJobData>(
    "ai.respond",
    {
      batchSize: 1, // Process one at a time for quality
      pollingIntervalSeconds: 2,
    },
    async (jobs) => {
      for (const job of jobs) {
        const { workspaceId, streamId, eventId, mentionedBy, question, mode } = job.data

        try {
          // Check if AI is enabled for this workspace
          const isEnabled = await usageService.isAIEnabled(workspaceId)
          if (!isEnabled) {
            logger.info({ workspaceId }, "AI not enabled for workspace, skipping Ariadne response")
            continue
          }

          // Check monthly budget
          const usage = await usageService.getMonthlyUsage(workspaceId)
          const budget = await usageService.getWorkspaceBudget(workspaceId)
          if (usage.totalCostCents >= budget) {
            logger.warn({ workspaceId, usage: usage.totalCostCents, budget }, "Workspace AI budget exceeded")
            await postAriadneResponse(
              streamService,
              streamId,
              "I'm sorry, but the workspace's AI budget for this month has been reached. Please contact your workspace admin to increase the budget.",
            )
            continue
          }

          // Get user info for context
          const userResult = await pool.query<{ name: string; email: string }>(
            sql`SELECT COALESCE(wp.display_name, u.name) as name, u.email
                FROM users u
                LEFT JOIN workspace_profiles wp ON u.id = wp.user_id AND wp.workspace_id = ${workspaceId}
                WHERE u.id = ${mentionedBy}`,
          )
          const mentionedByName = userResult.rows[0]?.name || userResult.rows[0]?.email || "someone"

          // Get stream type to determine context strategy
          const stream = await streamService.getStream(streamId)
          const streamType = stream?.streamType || "channel"

          // Fetch conversation history based on stream type
          const conversationHistory = await fetchConversationContext(
            streamService,
            pool,
            streamId,
            eventId,
            streamType,
          )

          // Custom instructions can be added later via workspace settings
          const customInstructions: string | undefined = undefined

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
          const result = await invokeAriadne(pool, context, question, customInstructions)

          // Track usage
          const costCents = calculateCost(Models.CLAUDE_HAIKU, result.usage)
          await usageService.trackUsage({
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
            const stream = await streamService.getStream(streamId)
            if (stream && stream.streamType === "channel") {
              // Create or get existing thread from the triggering message
              const { stream: thread } = await streamService.createThreadFromEvent(eventId, ARIADNE_PERSONA_ID)
              responseStreamId = thread.id
              logger.info({ eventId, threadId: thread.id }, "Ariadne responding in thread")
            }
          }

          // Post the response
          await postAriadneResponse(streamService, responseStreamId, result.response)

          // Reset engagement tracking - Ariadne is back in the conversation
          await resetEngagementTracking(responseStreamId)

          logger.info({ job: job.id, responseLength: result.response.length, costCents }, "Ariadne response posted")
        } catch (err) {
          logger.error({ err, job: job.id }, "Ariadne worker failed to process job")

          // Post error message
          try {
            await postAriadneResponse(
              streamService,
              streamId,
              "I encountered an error while processing your request. Please try again.",
            )
          } catch {
            // Ignore posting errors
          }

          throw err // Re-throw to trigger retry
        }
      }
    },
  )
}

/**
 * Post Ariadne's response as a message in the stream using agent_id.
 */
async function postAriadneResponse(streamService: StreamService, streamId: string, content: string): Promise<void> {
  // Post the message using createEvent with agentId instead of actorId
  await streamService.createEvent({
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
async function fetchConversationContext(
  streamService: StreamService,
  pool: Pool,
  streamId: string,
  eventId: string,
  streamType: string,
): Promise<ConversationMessage[]> {
  const conversationHistory: ConversationMessage[] = []

  try {
    if (streamType === "thinking_space" || streamType === "thread") {
      // For thinking spaces and threads, get all messages (up to a reasonable limit)
      const events = await streamService.getStreamEvents(streamId, 50)

      for (const event of events) {
        if (event.eventType !== "message" || !event.content) continue
        // Skip the current event - it's the question being asked
        if (event.id === eventId) continue

        const isAriadne = event.agentId === ARIADNE_PERSONA_ID
        conversationHistory.push({
          role: isAriadne ? "assistant" : "user",
          name: isAriadne ? "Ariadne" : event.actorName || event.actorEmail || "User",
          content: event.content,
        })
      }
    } else {
      // For channels, get surrounding messages around the triggering event
      // First, find the position of the triggering event
      const eventResult = await pool.query<{ created_at: Date }>(
        sql`SELECT created_at FROM stream_events WHERE id = ${eventId}`,
      )
      const eventTimestamp = eventResult.rows[0]?.created_at

      if (eventTimestamp) {
        // Get messages before and after the triggering event
        const beforeEvents = await pool.query<{
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

        // Add messages in chronological order (reverse the DESC order)
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

    logger.debug(
      { streamId, eventId, streamType, historyCount: conversationHistory.length },
      "Fetched conversation context",
    )
  } catch (err) {
    logger.error({ err, streamId, eventId }, "Failed to fetch conversation context")
  }

  return conversationHistory
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

  // High priority since user is waiting
  return await boss.send("ai.respond", params, {
    priority: JobPriority.URGENT,
    retryLimit: 2,
    retryDelay: 10,
    expireInSeconds: 300, // 5 minute timeout
  })
}
