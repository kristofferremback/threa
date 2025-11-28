import { Pool } from "pg"
import { sql } from "../lib/db"
import { getJobQueue, RespondJobData, JobPriority } from "../lib/job-queue"
import { invokeAriadne, AriadneContext } from "../ai/ariadne/agent"
import { AIUsageService } from "../services/ai-usage-service"
import { StreamService } from "../services/stream-service"
import { logger } from "../lib/logger"
import { Models, calculateCost } from "../lib/ai-providers"

const ARIADNE_PERSONA_ID = "pers_default_ariadne"

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

          // Custom instructions can be added later via workspace settings
          const customInstructions: string | undefined = undefined

          const context: AriadneContext = {
            workspaceId,
            streamId,
            mentionedBy,
            mentionedByName,
            mode: mode || "retrieval",
          }

          logger.info({ job: job.id, streamId, mentionedBy: mentionedByName, mode: mode || "retrieval" }, "Processing Ariadne request")

          // Invoke Ariadne
          const result = await invokeAriadne(pool, context, question, customInstructions)

          // Track usage
          const costCents = calculateCost(Models.CLAUDE_SONNET, result.usage)
          await usageService.trackUsage({
            workspaceId,
            userId: mentionedBy,
            jobType: "respond",
            model: Models.CLAUDE_SONNET,
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
