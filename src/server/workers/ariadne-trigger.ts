import { Pool } from "pg"
import { createRedisClient, connectRedisClient, type RedisClient } from "../lib/redis"
import { getJobQueue, JobPriority, type AriadneMode } from "../lib/job-queue"
import { logger } from "../lib/logger"

/**
 * Ariadne Trigger - Async listener for stream events
 *
 * Subscribes to Redis stream_event.created events and queues AI responses when:
 * 1. The event is in a thinking_space (always trigger as thinking_partner)
 * 2. The event mentions @ariadne (trigger as retrieval mode)
 *
 * This decouples AI triggering from the synchronous event creation flow,
 * making it easier to add more agents or extend behavior in the future.
 */

let redisSubscriber: RedisClient | null = null
let isRunning = false

export async function startAriadneTrigger(pool: Pool): Promise<void> {
  if (isRunning) {
    logger.warn("Ariadne trigger already running")
    return
  }

  logger.info("Starting Ariadne trigger (Redis subscriber)")

  redisSubscriber = createRedisClient({
    onError: (err) => {
      logger.error({ err }, "Redis subscriber error in Ariadne trigger")
    },
  })

  await connectRedisClient(redisSubscriber, "Ariadne trigger")

  // Subscribe to stream event creation
  await redisSubscriber.subscribe("event:stream_event.created", async (message: string) => {
    try {
      const event = JSON.parse(message)
      await handleStreamEvent(pool, event)
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
    redisSubscriber = null
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

async function handleStreamEvent(pool: Pool, event: StreamEventPayload): Promise<void> {
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

  if (!isThinkingSpace && !ariadneMentioned) {
    return
  }

  const mode: AriadneMode = isThinkingSpace ? "thinking_partner" : "retrieval"

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
      { eventId: event.event_id, streamId: event.stream_id, mode },
      "Ariadne trigger queued AI response",
    )
  } catch (err) {
    logger.error({ err, eventId: event.event_id }, "Ariadne trigger failed to queue job")
  }
}
