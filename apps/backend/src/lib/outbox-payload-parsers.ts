/**
 * Payload parsers for outbox events.
 *
 * These parsers validate and normalize outbox payloads, handling legacy events
 * that may have different structures. Use these instead of raw type casts to
 * ensure consistent handling across all listeners.
 */

import type { Pool, PoolClient } from "pg"
import type { AuthorType } from "@threa/types"
import { AuthorTypes } from "@threa/types"
import { withClient } from "../db"
import { MessageRepository } from "../repositories"

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
      content: string
      contentFormat: string
    }
  }
}

/**
 * Parse and normalize a message:created outbox payload.
 *
 * Attempts to extract data from both modern and legacy event formats:
 * - Modern: { streamId, workspaceId, event: { actorType, payload: { messageId } } }
 * - Legacy: { streamId, workspaceId, messageId } (no event wrapper)
 *
 * For legacy events, looks up the message to get the actual authorType.
 *
 * Returns null only if minimum required fields (streamId, workspaceId, messageId)
 * cannot be extracted.
 */
export async function parseMessageCreatedPayload(
  payload: unknown,
  pool: Pool
): Promise<NormalizedMessageCreatedPayload | null> {
  return withClient(pool, (client) => parseMessageCreatedPayloadWithClient(payload, client))
}

/**
 * Parse and normalize a message:created outbox payload using an existing client.
 *
 * This variant is for use within transactions where you already have a PoolClient.
 * See parseMessageCreatedPayload for format documentation.
 */
export async function parseMessageCreatedPayloadWithClient(
  payload: unknown,
  client: PoolClient
): Promise<NormalizedMessageCreatedPayload | null> {
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
          actorType: (event.actorType as AuthorType) ?? AuthorTypes.USER,
          actorId: (event.actorId as string | null) ?? null,
          payload: {
            messageId: eventPayload.messageId,
            content: (eventPayload.content as string) ?? "",
            contentFormat: (eventPayload.contentFormat as string) ?? "plain",
          },
        },
      }
    }
  }

  // Legacy format: messageId at top level, no event wrapper
  if (typeof p.messageId === "string") {
    const messageId = p.messageId

    // Look up message to get actual authorType
    const message = await MessageRepository.findById(client, messageId)

    return {
      workspaceId: p.workspaceId,
      streamId: p.streamId,
      event: {
        id: "",
        sequence: message ? String(message.sequence) : "0",
        actorType: message?.authorType ?? AuthorTypes.USER,
        actorId: message?.authorId ?? null,
        payload: {
          messageId,
          content: message?.content ?? (p.content as string) ?? "",
          contentFormat: message?.contentFormat ?? (p.contentFormat as string) ?? "plain",
        },
      },
    }
  }

  // Cannot extract minimum required fields
  return null
}
