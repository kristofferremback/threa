import type { Pool } from "pg"
import { withClient } from "../db"
import { OutboxListener, type OutboxListenerConfig } from "./outbox-listener"
import { PendingItemRepository, StreamStateRepository, StreamRepository } from "../repositories"
import type { OutboxEvent, MessageCreatedOutboxPayload } from "../repositories/outbox-repository"
import { pendingItemId } from "./id"
import { AuthorTypes, StreamTypes } from "@threa/types"
import { logger } from "./logger"

/**
 * Creates a memo accumulator listener that queues messages and conversations
 * for batch memo processing.
 *
 * Flow:
 * 1. Event arrives (message:created, conversation:created, conversation:updated)
 * 2. Queue item to memo_pending_items table
 * 3. Update stream state activity for debounce tracking
 *
 * The batch worker will process queued items based on per-stream debouncing:
 * - Cap: process at most every 5 minutes per stream
 * - Quick: process after 30s quiet per stream
 */
export function createMemoAccumulator(
  pool: Pool,
  config?: Omit<OutboxListenerConfig, "listenerId" | "handler">
): OutboxListener {
  return new OutboxListener(pool, {
    ...config,
    listenerId: "memo-accumulator",
    handler: async (outboxEvent: OutboxEvent) => {
      switch (outboxEvent.eventType) {
        case "message:created":
          await handleMessageCreated(pool, outboxEvent)
          break
        case "conversation:created":
        case "conversation:updated":
          await handleConversationEvent(pool, outboxEvent)
          break
      }
    },
  })
}

async function handleMessageCreated(pool: Pool, outboxEvent: OutboxEvent): Promise<void> {
  const payload = outboxEvent.payload as unknown as Record<string, unknown>

  if (
    typeof payload.streamId !== "string" ||
    typeof payload.workspaceId !== "string" ||
    !payload.event ||
    typeof payload.event !== "object"
  ) {
    return
  }

  const { event, streamId, workspaceId } = payload as unknown as MessageCreatedOutboxPayload
  const eventPayload = event.payload as Record<string, unknown>

  if (typeof eventPayload?.messageId !== "string") {
    return
  }

  if (event.actorType !== AuthorTypes.USER) {
    return
  }

  await withClient(pool, async (client) => {
    const stream = await StreamRepository.findById(client, streamId)
    if (!stream) {
      logger.warn({ streamId }, "Stream not found for memo accumulator")
      return
    }

    const topLevelStreamId = stream.type === StreamTypes.THREAD ? (stream.rootStreamId ?? streamId) : streamId

    const messageId = eventPayload.messageId as string

    await PendingItemRepository.queue(client, [
      {
        id: pendingItemId(),
        workspaceId,
        streamId: topLevelStreamId,
        itemType: "message",
        itemId: messageId,
      },
    ])

    await StreamStateRepository.upsertActivity(client, workspaceId, topLevelStreamId)

    logger.debug({ workspaceId, streamId: topLevelStreamId, messageId }, "Message queued for memo processing")
  })
}

async function handleConversationEvent(pool: Pool, outboxEvent: OutboxEvent): Promise<void> {
  const payload = outboxEvent.payload as unknown as Record<string, unknown>

  if (
    typeof payload.streamId !== "string" ||
    typeof payload.workspaceId !== "string" ||
    typeof payload.conversationId !== "string"
  ) {
    return
  }

  const { streamId, workspaceId, conversationId } = payload as {
    streamId: string
    workspaceId: string
    conversationId: string
  }

  await withClient(pool, async (client) => {
    const stream = await StreamRepository.findById(client, streamId)
    if (!stream) {
      logger.warn({ streamId }, "Stream not found for memo accumulator")
      return
    }

    const topLevelStreamId = stream.type === StreamTypes.THREAD ? (stream.rootStreamId ?? streamId) : streamId

    await PendingItemRepository.queue(client, [
      {
        id: pendingItemId(),
        workspaceId,
        streamId: topLevelStreamId,
        itemType: "conversation",
        itemId: conversationId,
      },
    ])

    await StreamStateRepository.upsertActivity(client, workspaceId, topLevelStreamId)

    logger.debug({ workspaceId, streamId: topLevelStreamId, conversationId }, "Conversation queued for memo processing")
  })
}
