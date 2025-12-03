/**
 * Ephemeral Events - Real-time events that are NOT persisted to the database.
 *
 * Use this for transient state like:
 * - AI thinking indicators
 * - Typing indicators (already handled separately)
 * - Presence updates
 *
 * These events go directly to Redis pub/sub → Socket.IO, bypassing the outbox.
 * They are fire-and-forget and will be lost if no clients are listening.
 */

import { createRedisClient, connectRedisClient, type RedisClient } from "./redis"
import { logger } from "./logger"

// Singleton Redis client for ephemeral events
let redisClient: RedisClient | null = null

async function getRedisClient(): Promise<RedisClient> {
  if (!redisClient) {
    redisClient = createRedisClient({
      onError: (err) => {
        logger.error({ err }, "Ephemeral events Redis client error")
      },
    })
    await connectRedisClient(redisClient, "Ephemeral events")
  }
  return redisClient
}

// ============================================================================
// Event Types
// ============================================================================

export const EphemeralEventType = {
  // Agent session events (persistent sessions with real-time updates)
  SESSION_STARTED: "ephemeral:session.started",
  SESSION_STEP: "ephemeral:session.step",
  SESSION_COMPLETED: "ephemeral:session.completed",

  // Legacy Ariadne thinking events (deprecated - use session events instead)
  ARIADNE_THINKING_START: "ephemeral:ariadne.thinking.start",
  ARIADNE_THINKING_STEP: "ephemeral:ariadne.thinking.step",
  ARIADNE_THINKING_DONE: "ephemeral:ariadne.thinking.done",
} as const

export type EphemeralEventType = (typeof EphemeralEventType)[keyof typeof EphemeralEventType]

// ============================================================================
// Event Payloads
// ============================================================================

export interface AriadneThinkingStartPayload {
  workspace_id: string
  stream_id: string
  event_id: string // The event that triggered Ariadne
  triggered_by_user_id: string
}

export interface AriadneThinkingStepPayload {
  workspace_id: string
  stream_id: string
  event_id: string
  step_type: "tool_call" | "reasoning" | "searching" | "analyzing"
  step_content: string // e.g., "Searching workspace knowledge..." or "Using search tool..."
}

export interface AriadneThinkingDonePayload {
  workspace_id: string
  stream_id: string
  event_id: string
  success: boolean
  error_message?: string
}

// ============================================================================
// Agent Session Event Payloads
// ============================================================================

import type { SessionStep, SessionStatus } from "../services/agent-session-service"

export interface SessionStartedPayload {
  workspace_id: string
  stream_id: string // The stream to emit to (for routing)
  session_stream_id: string // The stream where the session actually lives
  session_id: string
  triggering_event_id: string
  // Persona info for UI display
  persona_id?: string
  persona_name: string
  persona_avatar?: string
}

export interface SessionStepPayload {
  workspace_id: string
  stream_id: string
  session_id: string
  step: SessionStep
  // Persona info for fallback if session:started was missed
  persona_id?: string
  persona_name?: string
  persona_avatar?: string
}

export interface SessionCompletedPayload {
  workspace_id: string
  stream_id: string
  session_id: string
  status: SessionStatus
  summary?: string
  error_message?: string
  response_event_id?: string
}

// ============================================================================
// Publisher Functions
// ============================================================================

// Type mapping for ephemeral event payloads
type EphemeralPayloadMap = {
  [EphemeralEventType.SESSION_STARTED]: SessionStartedPayload
  [EphemeralEventType.SESSION_STEP]: SessionStepPayload
  [EphemeralEventType.SESSION_COMPLETED]: SessionCompletedPayload
  [EphemeralEventType.ARIADNE_THINKING_START]: AriadneThinkingStartPayload
  [EphemeralEventType.ARIADNE_THINKING_STEP]: AriadneThinkingStepPayload
  [EphemeralEventType.ARIADNE_THINKING_DONE]: AriadneThinkingDonePayload
}

/**
 * Publish an ephemeral event directly to Redis.
 * These events bypass the outbox and are not persisted.
 */
export async function publishEphemeralEvent<T extends keyof EphemeralPayloadMap>(
  eventType: T,
  payload: EphemeralPayloadMap[T],
): Promise<void> {
  try {
    const client = await getRedisClient()
    await client.publish(eventType, JSON.stringify(payload))
    logger.debug({ eventType, payload }, "Ephemeral event published")
  } catch (err) {
    // Don't throw - ephemeral events are best-effort
    logger.warn({ err, eventType }, "Failed to publish ephemeral event")
  }
}

// ============================================================================
// Convenience Functions for Ariadne
// ============================================================================

/**
 * Emit that Ariadne has started thinking about a message.
 */
export async function emitAriadneThinkingStart(
  workspaceId: string,
  streamId: string,
  eventId: string,
  triggeredByUserId: string,
): Promise<void> {
  await publishEphemeralEvent(EphemeralEventType.ARIADNE_THINKING_START, {
    workspace_id: workspaceId,
    stream_id: streamId,
    event_id: eventId,
    triggered_by_user_id: triggeredByUserId,
  })
}

/**
 * Emit a thinking step (tool call, reasoning, etc.).
 */
export async function emitAriadneThinkingStep(
  workspaceId: string,
  streamId: string,
  eventId: string,
  stepType: AriadneThinkingStepPayload["step_type"],
  stepContent: string,
): Promise<void> {
  await publishEphemeralEvent(EphemeralEventType.ARIADNE_THINKING_STEP, {
    workspace_id: workspaceId,
    stream_id: streamId,
    event_id: eventId,
    step_type: stepType,
    step_content: stepContent,
  })
}

/**
 * Emit that Ariadne has finished thinking.
 */
export async function emitAriadneThinkingDone(
  workspaceId: string,
  streamId: string,
  eventId: string,
  success: boolean,
  errorMessage?: string,
): Promise<void> {
  await publishEphemeralEvent(EphemeralEventType.ARIADNE_THINKING_DONE, {
    workspace_id: workspaceId,
    stream_id: streamId,
    event_id: eventId,
    success,
    error_message: errorMessage,
  })
}

// ============================================================================
// Convenience Functions for Agent Sessions
// ============================================================================

/**
 * Emit that an agent session has started.
 * @param streamId - The stream to emit to (for routing)
 * @param sessionStreamId - The stream where the session actually lives (defaults to streamId)
 */
export async function emitSessionStarted(
  workspaceId: string,
  streamId: string,
  sessionId: string,
  triggeringEventId: string,
  options?: {
    sessionStreamId?: string
    personaId?: string
    personaName?: string
    personaAvatar?: string
  },
): Promise<void> {
  await publishEphemeralEvent(EphemeralEventType.SESSION_STARTED, {
    workspace_id: workspaceId,
    stream_id: streamId,
    session_stream_id: options?.sessionStreamId ?? streamId,
    session_id: sessionId,
    triggering_event_id: triggeringEventId,
    persona_id: options?.personaId,
    persona_name: options?.personaName ?? "Ariadne",
    persona_avatar: options?.personaAvatar,
  })
}

/**
 * Emit a session step update.
 */
export async function emitSessionStep(
  workspaceId: string,
  streamId: string,
  sessionId: string,
  step: SessionStep,
  options?: {
    personaId?: string
    personaName?: string
    personaAvatar?: string
  },
): Promise<void> {
  await publishEphemeralEvent(EphemeralEventType.SESSION_STEP, {
    workspace_id: workspaceId,
    stream_id: streamId,
    session_id: sessionId,
    step,
    persona_id: options?.personaId,
    persona_name: options?.personaName,
    persona_avatar: options?.personaAvatar,
  })
}

/**
 * Emit that an agent session has completed.
 */
export async function emitSessionCompleted(
  workspaceId: string,
  streamId: string,
  sessionId: string,
  status: SessionStatus,
  options?: {
    summary?: string
    errorMessage?: string
    responseEventId?: string
  },
): Promise<void> {
  await publishEphemeralEvent(EphemeralEventType.SESSION_COMPLETED, {
    workspace_id: workspaceId,
    stream_id: streamId,
    session_id: sessionId,
    status,
    summary: options?.summary,
    error_message: options?.errorMessage,
    response_event_id: options?.responseEventId,
  })
}

/**
 * Cleanup function for graceful shutdown.
 */
export async function closeEphemeralEventsClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit()
    redisClient = null
    logger.info("Ephemeral events Redis client closed")
  }
}
