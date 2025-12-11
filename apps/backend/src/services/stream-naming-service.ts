import { Pool } from "pg"
import { withTransaction } from "../db"
import { StreamRepository } from "../repositories/stream-repository"
import { MessageRepository } from "../repositories/message-repository"
import { OutboxRepository } from "../repositories/outbox-repository"
import { OpenRouterClient } from "../lib/openrouter"
import { needsAutoNaming } from "../lib/display-name"
import { logger } from "../lib/logger"

const NAMING_PROMPT = `Generate a short, descriptive title (2-5 words) for this conversation. Return ONLY the title, no quotes or explanation. If there isn't enough context yet to generate a meaningful title, respond with exactly: NOT_ENOUGH_CONTEXT

Conversation:`

const MAX_MESSAGES_FOR_NAMING = 10

export class StreamNamingService {
  constructor(
    private pool: Pool,
    private openRouterClient: OpenRouterClient,
  ) {}

  /**
   * Attempts to auto-generate a display name for a stream.
   * Called after each message is created in scratchpads/threads.
   * Uses SELECT FOR UPDATE SKIP LOCKED to prevent concurrent LLM calls.
   * Returns true if a name was successfully generated.
   */
  async attemptAutoNaming(streamId: string): Promise<boolean> {
    return withTransaction(this.pool, async (client) => {
      // Lock the stream row - if another transaction is already naming, skip
      const stream = await StreamRepository.findByIdForUpdate(client, streamId)
      if (!stream) {
        // Either not found or locked by another transaction
        logger.debug({ streamId }, "Stream not found or locked, skipping auto-naming")
        return false
      }

      if (!needsAutoNaming(stream)) {
        return false
      }

      // Fetch recent messages to build context
      const messages = await MessageRepository.findByStream(client, streamId, {
        limit: MAX_MESSAGES_FOR_NAMING,
      })

      if (messages.length === 0) {
        return false
      }

      // Build conversation context for LLM
      const conversationText = messages
        .map((m) => m.content)
        .reverse() // Messages come DESC, we want chronological order
        .join("\n---\n")

      const prompt = `${NAMING_PROMPT}\n\n${conversationText}`

      // Call LLM
      const generatedName = await this.openRouterClient.generateText([
        { role: "user", content: prompt },
      ])

      if (!generatedName || generatedName === "NOT_ENOUGH_CONTEXT") {
        logger.debug(
          { streamId, messageCount: messages.length },
          "Not enough context for auto-naming yet",
        )
        return false
      }

      // Clean up the response (remove quotes, trim)
      const cleanName = generatedName.replace(/^["']|["']$/g, "").trim()

      if (cleanName.length === 0 || cleanName.length > 100) {
        logger.warn({ streamId, generatedName }, "Invalid generated name")
        return false
      }

      // Update the stream with the generated name
      await StreamRepository.update(client, streamId, {
        displayName: cleanName,
        displayNameGeneratedAt: new Date(),
      })

      // Emit to outbox for real-time delivery
      await OutboxRepository.insert(client, "stream:display_name_updated", {
        streamId,
        displayName: cleanName,
      })

      logger.info({ streamId, displayName: cleanName }, "Auto-generated stream display name")

      return true
    })
  }
}
