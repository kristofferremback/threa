/**
 * Payload parsers for outbox events.
 *
 * These parsers validate and normalize outbox payloads. Use these instead of
 * raw type casts to ensure consistent handling across all listeners.
 */

import type { AuthorType } from "@threa/types"
import { AuthorTypes } from "@threa/types"

/**
 * Normalized payload for message:created events.
 * Returned when minimum required fields can be extracted.
 */
export interface NormalizedMessageCreatedPayload {
  workspaceId: string
  streamId: string
  event: {
    id: string
    sequence: string
    actorType: AuthorType
    actorId: string | null
    payload: {
      messageId: string
      contentMarkdown: string
    }
  }
}

/**
 * Parse and normalize a message:created outbox payload.
 *
 * Expected format: { streamId, workspaceId, event: { actorType, payload: { messageId } } }
 *
 * Returns null if minimum required fields cannot be extracted.
 */
export function parseMessageCreatedPayload(payload: unknown): NormalizedMessageCreatedPayload | null {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const p = payload as Record<string, unknown>

  // These are required in all formats
  if (typeof p.workspaceId !== "string" || typeof p.streamId !== "string") {
    return null
  }

  const event = p.event as Record<string, unknown> | undefined

  // Modern format: event wrapper exists with nested payload
  if (event && typeof event === "object") {
    const eventPayload = event.payload as Record<string, unknown> | undefined

    if (eventPayload && typeof eventPayload === "object" && typeof eventPayload.messageId === "string") {
      return {
        workspaceId: p.workspaceId,
        streamId: p.streamId,
        event: {
          id: (event.id as string) ?? "",
          sequence: (event.sequence as string) ?? "0",
          actorType: (event.actorType as AuthorType) ?? AuthorTypes.MEMBER,
          actorId: (event.actorId as string | null) ?? null,
          payload: {
            messageId: eventPayload.messageId,
            contentMarkdown: (eventPayload.contentMarkdown as string) ?? "",
          },
        },
      }
    }
  }

  return null
}
