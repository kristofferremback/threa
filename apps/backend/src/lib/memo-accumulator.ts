import type { Pool } from "pg"
import { withClient, type DatabasePools } from "../db"
import { OutboxListener, type OutboxListenerConfig } from "./outbox-listener"
import { PendingItemRepository, StreamStateRepository, StreamRepository } from "../repositories"
import type { OutboxEvent } from "../repositories/outbox-repository"
import { parseMessageCreatedPayload } from "./outbox-payload-parsers"
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
  pools: DatabasePools,
  config?: Omit<OutboxListenerConfig, "listenerId" | "handler" | "listenPool" | "queryPool">
): OutboxListener {
  return new OutboxListener({
    ...config,
    listenPool: pools.listen,
    queryPool: pools.main,
    listenerId: "memo-accumulator",
    handler: async (outboxEvent: OutboxEvent) => {
      switch (outboxEvent.eventType) {
        case "message:created":
          await handleMessageCreated(pools.main, outboxEvent)
          break
        case "conversation:created":
        case "conversation:updated":
          await handleConversationEvent(pools.main, outboxEvent)
          break
      }
    },
  })
}

async function handleMessageCreated(pool: Pool, outboxEvent: OutboxEvent): Promise<void> {
  const payload = await parseMessageCreatedPayload(outboxEvent.payload, pool)
  if (!payload) {
    logger.debug({ eventId: outboxEvent.id }, "Memo accumulator: malformed event, skipping")
    return
  }

  const { streamId, workspaceId, event } = payload

  if (event.actorType !== AuthorTypes.USER) {
    return
  }

  const messageId = event.payload.messageId

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
