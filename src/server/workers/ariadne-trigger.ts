import { Pool } from "pg"
import { sql } from "../lib/db"
import { createRedisClient, connectRedisClient, type RedisClient } from "../lib/redis"
import { getJobQueue, JobPriority, type AriadneMode } from "../lib/job-queue"
import { checkAriadneEngagement } from "../lib/ollama"
import { logger } from "../lib/logger"

const ARIADNE_PERSONA_ID = "pers_default_ariadne"
const MAX_UNDIRECTED_MESSAGES = 10 // Ariadne "leaves" after this many undirected messages
const ENGAGEMENT_CACHE_TTL = 3600 // 1 hour TTL for engagement tracking

/**
 * Ariadne Trigger - Async listener for stream events
 *
 * Subscribes to Redis stream_event.created events and queues AI responses when:
 * 1. The event is in a thinking_space (always trigger as thinking_partner)
 * 2. The event mentions @ariadne (trigger as retrieval mode)
 * 3. Ariadne has participated before AND the message seems directed at her (auto-engage)
 *
 * This decouples AI triggering from the synchronous event creation flow,
 * making it easier to add more agents or extend behavior in the future.
 */

let redisSubscriber: RedisClient | null = null
let redisClient: RedisClient | null = null // For engagement tracking
let isRunning = false
let pool: Pool | null = null

export async function startAriadneTrigger(dbPool: Pool): Promise<void> {
  if (isRunning) {
    logger.warn("Ariadne trigger already running")
    return
  }

  pool = dbPool
  logger.info("Starting Ariadne trigger (Redis subscriber)")

  redisSubscriber = createRedisClient({
    onError: (err) => {
      logger.error({ err }, "Redis subscriber error in Ariadne trigger")
    },
  })

  redisClient = createRedisClient({
    onError: (err) => {
      logger.error({ err }, "Redis client error in Ariadne trigger")
    },
  })

  await connectRedisClient(redisSubscriber, "Ariadne trigger subscriber")
  await connectRedisClient(redisClient, "Ariadne trigger client")

  // Subscribe to stream event creation
  await redisSubscriber.subscribe("event:stream_event.created", async (message: string) => {
    try {
      const event = JSON.parse(message)
      await handleStreamEvent(event)
    } catch (err) {
      logger.error({ err }, "Failed to process stream event in Ariadne trigger")
    }
  })

  isRunning = true
  logger.info("Ariadne trigger started")
}

export async function stopAriadneTrigger(): Promise<void> {
  if (!isRunning || !redisSubscriber) return

  try {
    await redisSubscriber.unsubscribe("event:stream_event.created")
    await redisSubscriber.quit()
    if (redisClient) {
      await redisClient.quit()
      redisClient = null
    }
    redisSubscriber = null
    pool = null
    isRunning = false
    logger.info("Ariadne trigger stopped")
  } catch (err) {
    logger.error({ err }, "Error stopping Ariadne trigger")
  }
}

interface StreamEventPayload {
  event_id: string
  stream_id: string
  workspace_id: string
  stream_type?: string
  event_type: string
  actor_id?: string
  agent_id?: string
  content?: string
  mentions?: Array<{ type: string; id: string; label?: string }>
}

/**
 * Get the Redis key for tracking undirected messages in a stream.
 */
function getUndirectedCountKey(streamId: string): string {
  return `ariadne:undirected:${streamId}`
}

/**
 * Check if Ariadne has participated in this stream before.
 */
async function hasAriadneParticipated(streamId: string): Promise<boolean> {
  if (!pool) return false

  try {
    const result = await pool.query<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM stream_events
          WHERE stream_id = ${streamId}
            AND agent_id = ${ARIADNE_PERSONA_ID}
            AND deleted_at IS NULL
          LIMIT 1`,
    )
    return parseInt(result.rows[0]?.count || "0", 10) > 0
  } catch (err) {
    logger.error({ err, streamId }, "Failed to check Ariadne participation")
    return false
  }
}

/**
 * Get recent conversation context for engagement check.
 */
async function getRecentContext(streamId: string, currentEventId: string): Promise<{
  recentMessages: string
  ariadneLastResponse?: string
}> {
  if (!pool) return { recentMessages: "" }

  try {
    // Get recent messages (last 10)
    const result = await pool.query<{
      id: string
      content: string
      agent_id: string | null
      actor_name: string | null
    }>(
      sql`SELECT e.id, tm.content, e.agent_id,
                 COALESCE(wp.display_name, u.name, u.email) as actor_name
          FROM stream_events e
          INNER JOIN streams s ON e.stream_id = s.id
          LEFT JOIN users u ON e.actor_id = u.id
          LEFT JOIN workspace_profiles wp ON wp.workspace_id = s.workspace_id AND wp.user_id = e.actor_id
          LEFT JOIN text_messages tm ON e.content_type = 'text_message' AND e.content_id = tm.id
          WHERE e.stream_id = ${streamId}
            AND e.event_type = 'message'
            AND e.deleted_at IS NULL
            AND e.id != ${currentEventId}
          ORDER BY e.created_at DESC
          LIMIT 10`,
    )

    let ariadneLastResponse: string | undefined
    const messages: string[] = []

    for (const row of result.rows) {
      if (!row.content) continue

      if (row.agent_id === ARIADNE_PERSONA_ID && !ariadneLastResponse) {
        ariadneLastResponse = row.content
      }

      const name = row.agent_id === ARIADNE_PERSONA_ID ? "Ariadne" : row.actor_name || "User"
      messages.push(`[${name}]: ${row.content}`)
    }

    // Reverse to chronological order
    return {
      recentMessages: messages.reverse().join("\n"),
      ariadneLastResponse,
    }
  } catch (err) {
    logger.error({ err, streamId }, "Failed to get recent context")
    return { recentMessages: "" }
  }
}

/**
 * Track undirected message count and check if Ariadne should leave.
 */
async function shouldAriadneLeave(streamId: string, isDirected: boolean, topicChanged: boolean): Promise<boolean> {
  if (!redisClient) return false

  const key = getUndirectedCountKey(streamId)

  try {
    if (isDirected) {
      // Reset counter when message is directed at Ariadne
      await redisClient.del(key)
      return false
    }

    if (topicChanged) {
      // Topic changed significantly - Ariadne leaves
      await redisClient.del(key)
      logger.info({ streamId }, "Ariadne leaving - topic changed")
      return true
    }

    // Increment undirected counter
    const count = await redisClient.incr(key)
    await redisClient.expire(key, ENGAGEMENT_CACHE_TTL)

    if (count >= MAX_UNDIRECTED_MESSAGES) {
      // Too many undirected messages - Ariadne leaves
      await redisClient.del(key)
      logger.info({ streamId, count }, "Ariadne leaving - too many undirected messages")
      return true
    }

    return false
  } catch (err) {
    logger.error({ err, streamId }, "Failed to track undirected messages")
    return false
  }
}

/**
 * Reset engagement tracking when Ariadne responds (she's back in the conversation).
 */
export async function resetEngagementTracking(streamId: string): Promise<void> {
  if (!redisClient) return

  try {
    await redisClient.del(getUndirectedCountKey(streamId))
  } catch (err) {
    logger.error({ err, streamId }, "Failed to reset engagement tracking")
  }
}

async function handleStreamEvent(event: StreamEventPayload): Promise<void> {
  // Only process message events from users (not agents)
  if (event.event_type !== "message" || !event.actor_id || event.agent_id) {
    return
  }

  // Skip if no content
  if (!event.content) {
    return
  }

  const isThinkingSpace = event.stream_type === "thinking_space"
  const ariadneMentioned = event.mentions?.some(
    (m) => m.type === "user" && m.label?.toLowerCase() === "ariadne",
  )

  let shouldTrigger = isThinkingSpace || ariadneMentioned
  let mode: AriadneMode = isThinkingSpace ? "thinking_partner" : "retrieval"

  // If not explicitly triggered, check for auto-engagement
  if (!shouldTrigger) {
    // Check if Ariadne has participated in this stream before
    const hasParticipated = await hasAriadneParticipated(event.stream_id)

    if (hasParticipated) {
      // Get recent context for engagement check
      const context = await getRecentContext(event.stream_id, event.event_id)

      // Use granite4 to check if message is directed at Ariadne
      const engagementResult = await checkAriadneEngagement(
        event.content,
        context.recentMessages,
        context.ariadneLastResponse,
      )

      // Check if Ariadne should leave this conversation
      const shouldLeave = await shouldAriadneLeave(
        event.stream_id,
        engagementResult.isDirectedAtAriadne,
        engagementResult.topicChanged,
      )

      if (!shouldLeave && engagementResult.isDirectedAtAriadne) {
        shouldTrigger = true
        // Use thread context for auto-engaged responses
        mode = event.stream_type === "thread" ? "retrieval" : "retrieval"

        logger.info(
          { eventId: event.event_id, streamId: event.stream_id },
          "Ariadne auto-engaging with follow-up message",
        )
      }
    }
  }

  if (!shouldTrigger) {
    return
  }

  try {
    const boss = getJobQueue()
    await boss.send(
      "ai.respond",
      {
        workspaceId: event.workspace_id,
        streamId: event.stream_id,
        eventId: event.event_id,
        mentionedBy: event.actor_id,
        question: event.content,
        mode,
      },
      {
        priority: JobPriority.URGENT,
        retryLimit: 2,
        retryDelay: 10,
        expireInSeconds: 300,
      },
    )

    logger.info(
      { eventId: event.event_id, streamId: event.stream_id, mode, autoEngaged: !isThinkingSpace && !ariadneMentioned },
      "Ariadne trigger queued AI response",
    )
  } catch (err) {
    logger.error({ err, eventId: event.event_id }, "Ariadne trigger failed to queue job")
  }
}
