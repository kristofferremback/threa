import { Pool } from "pg"
import { withClient } from "../db"
import { StreamRepository, PersonaRepository, MessageRepository } from "../repositories"
import { AIService } from "./ai-service"
import { EventService } from "./event-service"
import { logger } from "../lib/logger"

const CONTEXT_MESSAGE_LIMIT = 20

export interface HandleMessageCreatedParams {
  streamId: string
  messageId: string
  authorType: "user" | "persona"
}

export class CompanionService {
  constructor(
    private pool: Pool,
    private aiService: AIService,
    private eventService: EventService,
  ) {}

  async handleMessageCreated(params: HandleMessageCreatedParams): Promise<void> {
    const { streamId, messageId, authorType } = params

    // Don't respond to persona messages (avoid infinite loops)
    if (authorType === "persona") {
      return
    }

    try {
      const shouldRespond = await this.shouldRespond(streamId)
      if (!shouldRespond) {
        return
      }

      const persona = await this.getPersonaForStream(streamId)
      if (!persona) {
        logger.warn({ streamId }, "No persona found for stream, skipping companion response")
        return
      }

      const messages = await this.eventService.getMessages(streamId, {
        limit: CONTEXT_MESSAGE_LIMIT,
      })

      if (messages.length === 0) {
        return
      }

      // Messages come in descending order (newest first), reverse for context
      const contextMessages = messages.reverse()

      logger.info(
        {
          streamId,
          personaId: persona.id,
          personaName: persona.name,
          contextMessageCount: contextMessages.length,
        },
        "Generating companion response",
      )

      const response = await this.aiService.generateResponse({
        persona,
        messages: contextMessages,
      })

      if (!response) {
        logger.warn({ streamId, personaId: persona.id }, "AI returned no response")
        return
      }

      // Post the response as the persona
      await this.eventService.createMessage({
        streamId,
        authorId: persona.id,
        authorType: "persona",
        content: response,
        contentFormat: "markdown",
      })

      logger.info(
        { streamId, personaId: persona.id },
        "Companion response posted",
      )
    } catch (err) {
      logger.error({ err, streamId, messageId }, "Failed to generate companion response")
      // Don't rethrow - companion failure shouldn't affect message delivery
    }
  }

  private async shouldRespond(streamId: string): Promise<boolean> {
    return withClient(this.pool, async (client) => {
      const stream = await StreamRepository.findById(client, streamId)
      if (!stream) {
        return false
      }

      // Only respond if companion mode is 'on'
      return stream.companionMode === "on"
    })
  }

  private async getPersonaForStream(streamId: string) {
    return withClient(this.pool, async (client) => {
      const stream = await StreamRepository.findById(client, streamId)
      if (!stream) {
        return null
      }

      // Use stream's configured persona, or fall back to system default
      if (stream.companionPersonaId) {
        return PersonaRepository.findById(client, stream.companionPersonaId)
      }

      return PersonaRepository.findSystemDefault(client)
    })
  }
}
