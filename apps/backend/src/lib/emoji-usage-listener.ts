import type { Pool } from "pg"
import { withClient, type DatabasePools } from "../db"
import { OutboxListener, type OutboxListenerConfig } from "./outbox-listener"
import type { OutboxEvent, ReactionOutboxPayload } from "../repositories/outbox-repository"
import { EmojiUsageRepository } from "../repositories/emoji-usage-repository"
import { parseMessageCreatedPayload } from "./outbox-payload-parsers"
import { AuthorTypes } from "@threa/types"
import { logger } from "./logger"
import { emojiUsageId } from "./id"
import { isValidShortcode } from "./emoji"

/**
 * Extract shortcodes from normalized message content.
 * Content is already normalized (raw emoji converted to :shortcode:).
 * Returns a map of shortcode (without colons) -> count.
 */
function extractEmojiFromContent(content: string): Map<string, number> {
  const counts = new Map<string, number>()
  const regex = /:([a-z0-9_+-]+):/g
  let match

  while ((match = regex.exec(content)) !== null) {
    const shortcode = match[1]
    if (isValidShortcode(shortcode)) {
      counts.set(shortcode, (counts.get(shortcode) ?? 0) + 1)
    }
  }

  return counts
}

/**
 * Strip colons from a shortcode if present.
 * :+1: -> +1
 * +1 -> +1
 */
function stripColons(shortcode: string): string {
  if (shortcode.startsWith(":") && shortcode.endsWith(":")) {
    return shortcode.slice(1, -1)
  }
  return shortcode
}

/**
 * Creates an emoji usage listener that tracks emoji usage from messages and reactions.
 *
 * Flow:
 * 1. Message/reaction event arrives (via outbox)
 * 2. Extract emoji shortcodes from content or reaction
 * 3. Insert usage records for personalized emoji ordering
 */
export function createEmojiUsageListener(
  pools: DatabasePools,
  config?: Omit<OutboxListenerConfig, "listenerId" | "handler" | "listenPool" | "queryPool">
): OutboxListener {
  return new OutboxListener({
    ...config,
    listenPool: pools.listen,
    queryPool: pools.main,
    listenerId: "emoji-usage",
    handler: async (outboxEvent: OutboxEvent) => {
      if (outboxEvent.eventType === "message:created") {
        await handleMessageCreated(pools.main, outboxEvent)
      } else if (outboxEvent.eventType === "reaction:added") {
        await handleReactionAdded(pools.main, outboxEvent)
      }
    },
  })
}

async function handleMessageCreated(pool: Pool, outboxEvent: OutboxEvent): Promise<void> {
  const payload = await parseMessageCreatedPayload(outboxEvent.payload, pool)
  if (!payload) {
    logger.debug({ eventId: outboxEvent.id }, "Emoji usage listener: malformed message event, skipping")
    return
  }

  // Only track user messages (not persona/system messages)
  if (payload.event.actorType !== AuthorTypes.USER) {
    return
  }

  const userId = payload.event.actorId
  if (!userId) {
    logger.warn({ eventId: outboxEvent.id }, "Emoji usage listener: USER message has no actorId, skipping")
    return
  }

  const content = payload.event.payload.content
  const emojiCounts = extractEmojiFromContent(content)

  if (emojiCounts.size === 0) {
    return
  }

  const items = Array.from(emojiCounts.entries()).map(([shortcode, count]) => ({
    id: emojiUsageId(),
    workspaceId: payload.workspaceId,
    userId,
    interactionType: "message" as const,
    shortcode,
    occurrenceCount: count,
    sourceId: payload.event.payload.messageId,
  }))

  await withClient(pool, async (client) => {
    await EmojiUsageRepository.insertBatch(client, items)
  })

  logger.debug(
    {
      eventId: outboxEvent.id,
      messageId: payload.event.payload.messageId,
      emojiCount: emojiCounts.size,
    },
    "Emoji usage tracked for message"
  )
}

async function handleReactionAdded(pool: Pool, outboxEvent: OutboxEvent): Promise<void> {
  const payload = outboxEvent.payload as ReactionOutboxPayload

  if (!payload.workspaceId || !payload.userId || !payload.emoji || !payload.messageId) {
    logger.debug({ eventId: outboxEvent.id }, "Emoji usage listener: malformed reaction event, skipping")
    return
  }

  const shortcode = stripColons(payload.emoji)

  if (!isValidShortcode(shortcode)) {
    logger.debug(
      { eventId: outboxEvent.id, emoji: payload.emoji },
      "Emoji usage listener: invalid shortcode in reaction, skipping"
    )
    return
  }

  await withClient(pool, async (client) => {
    await EmojiUsageRepository.insert(client, {
      id: emojiUsageId(),
      workspaceId: payload.workspaceId,
      userId: payload.userId,
      interactionType: "message_reaction",
      shortcode,
      occurrenceCount: 1,
      sourceId: payload.messageId,
    })
  })

  logger.debug(
    {
      eventId: outboxEvent.id,
      messageId: payload.messageId,
      emoji: shortcode,
    },
    "Emoji usage tracked for reaction"
  )
}
