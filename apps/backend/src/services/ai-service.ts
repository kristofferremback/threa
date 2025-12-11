import { OpenRouterClient, OpenRouterMessage } from "../lib/openrouter"
import { logger } from "../lib/logger"
import type { Persona } from "../repositories"
import type { Message } from "../repositories"

export interface GenerateResponseParams {
  persona: Persona
  messages: Message[]
  systemPromptOverride?: string
}

export class AIService {
  private client: OpenRouterClient

  constructor(apiKey: string) {
    this.client = new OpenRouterClient(apiKey)
  }

  async generateResponse(params: GenerateResponseParams): Promise<string | null> {
    const { persona, messages, systemPromptOverride } = params

    // Build system prompt from persona
    const systemPrompt = systemPromptOverride ?? persona.systemPrompt ?? this.getDefaultPrompt()

    // Convert messages to OpenRouter format
    const chatMessages: OpenRouterMessage[] = [
      { role: "system", content: systemPrompt },
      ...messages.map((msg) => ({
        role: (msg.authorType === "persona" ? "assistant" : "user") as "user" | "assistant",
        content: msg.content,
      })),
    ]

    logger.debug(
      {
        personaId: persona.id,
        personaName: persona.name,
        model: persona.model,
        messageCount: messages.length,
      },
      "Generating AI response",
    )

    const response = await this.client.generateText(chatMessages, {
      model: this.mapModelToOpenRouter(persona.model),
      maxTokens: persona.maxTokens ?? 1024,
      temperature: persona.temperature ?? 0.7,
    })

    if (!response) {
      logger.warn({ personaId: persona.id }, "AI response was null")
    }

    return response
  }

  private mapModelToOpenRouter(model: string): string {
    // Model format is "provider:model" e.g. "anthropic:claude-sonnet-4-20250514"
    // OpenRouter wants "anthropic/claude-sonnet-4-20250514"
    const [provider, modelName] = model.split(":")
    if (!modelName) {
      // Already in OpenRouter format or just a model name
      return model
    }
    return `${provider}/${modelName}`
  }

  private getDefaultPrompt(): string {
    return `You are a helpful AI assistant. Be concise but thoughtful in your responses.`
  }
}
