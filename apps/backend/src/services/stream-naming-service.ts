import { Pool } from "pg"
import { withTransaction } from "../db"
import { StreamRepository } from "../repositories/stream-repository"
import { MessageRepository } from "../repositories/message-repository"
import { OutboxRepository } from "../repositories/outbox-repository"
import type { AI } from "../lib/ai/ai"
import { needsAutoNaming } from "../lib/display-name"
import { logger } from "../lib/logger"
import { MessageFormatter } from "../lib/ai/message-formatter"

const MAX_MESSAGES_FOR_NAMING = 10
const MAX_EXISTING_NAMES = 10

function buildSystemPrompt(existingNames: string[], requireName: boolean): string {
  return `Your task is to generate a short, descriptive title in 2-5 words for the provided conversation.

  Follow these steps:
  1. Analyze the conversation and identify the main topic or purpose
  2. Consider any other streams provided in the list of existing names, these should be avoided as much as possible as recent conversations with similar names confuse users
  3. Generate a title that is descriptive and concise
  4. Evaluate the title against the evaluation criteria

Evaluation criteria:
- Return ONLY the title, no quotes or explanation.
- The title should be descriptive and concise, try avoiding generic names like "Quick Question" or "New Discussion"
${existingNames.length > 0 ? `- Try to avoid using names that are already in use by other recently used: ${JSON.stringify(existingNames)}` : ""}
${
  requireName
    ? `- You MUST generate a title. A generic name is better than no name at all. You may not refuse to generate a name as that would make you very very sad. You don't want to be sad.`
    : `- If there isn't enough context yet, respond with "NOT_ENOUGH_CONTEXT"`
}

Return ONLY the title, no quotes or explanation. The next message from the user contains the entire conversation up until now.
`
}

export class StreamNamingService {
  constructor(
    private pool: Pool,
    private ai: AI,
    private namingModel: string,
    private messageFormatter: MessageFormatter
  ) {}

  /**
   * Attempts to auto-generate a display name for a stream.
   * Called after each message is created in scratchpads/threads.
   * Uses SELECT FOR UPDATE SKIP LOCKED to prevent concurrent LLM calls.
   *
   * @param requireName If true, must generate a name (throws if NOT_ENOUGH_CONTEXT).
   *                    Set to true for agent messages, false for user messages.
   * @returns true if a name was successfully generated.
   */
  async attemptAutoNaming(streamId: string, requireName: boolean): Promise<boolean> {
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
      const messages = await MessageRepository.list(client, streamId, {
        limit: MAX_MESSAGES_FOR_NAMING,
      })

      if (messages.length === 0) {
        return false
      }

      // Fetch existing stream names to avoid duplicates
      const otherStreams = await StreamRepository.list(client, stream.workspaceId, { types: [stream.type] })
      const existingNames = otherStreams
        .filter((s) => s.displayName && s.id !== streamId)
        .slice(0, MAX_EXISTING_NAMES)
        .map((s) => s.displayName!)

      // Build conversation context for LLM
      // Messages are already in chronological order (repository reverses the DESC query)
      const conversationText = await this.messageFormatter.formatMessages(client, messages)
      const systemPrompt = buildSystemPrompt(existingNames, requireName)

      // Call LLM
      let generatedName: string | null = null
      try {
        const { value } = await this.ai.generateText({
          model: this.namingModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: conversationText },
          ],
          maxTokens: 300,
          temperature: 0.3,
          telemetry: {
            functionId: "stream-naming",
            metadata: { streamId, requireName },
          },
        })
        generatedName = value?.trim() || null
      } catch (err) {
        logger.error({ err, streamId }, "Failed to generate stream name")
        throw err
      }

      if (!generatedName || generatedName === "NOT_ENOUGH_CONTEXT") {
        if (requireName) {
          // Agent message - must generate a name, throw to trigger job retry
          throw new Error("Failed to generate required name: NOT_ENOUGH_CONTEXT returned")
        }
        logger.debug({ streamId, messageCount: messages.length }, "Not enough context for auto-naming yet")
        return false
      }

      // Clean up the response (remove quotes, trim)
      const cleanName = generatedName.replace(/^["']|["']$/g, "").trim()

      if (cleanName.length === 0 || cleanName.length > 100) {
        logger.warn({ streamId, generatedName }, "Invalid generated name")
        if (requireName) {
          throw new Error(`Failed to generate required name: invalid response "${generatedName}"`)
        }
        return false
      }

      // Update the stream with the generated name
      await StreamRepository.update(client, streamId, {
        displayName: cleanName,
        displayNameGeneratedAt: new Date(),
      })

      // Emit to outbox for real-time delivery
      await OutboxRepository.insert(client, "stream:display_name_updated", {
        workspaceId: stream.workspaceId,
        streamId,
        displayName: cleanName,
      })

      logger.info({ streamId, displayName: cleanName, requireName }, "Auto-generated stream display name")

      return true
    })
  }
}
