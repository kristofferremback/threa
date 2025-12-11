import { logger } from "./logger"

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface OpenRouterOptions {
  model?: string
  maxTokens?: number
  temperature?: number
}

export interface OpenRouterResponse {
  id: string
  choices: {
    message: {
      role: string
      content: string
    }
    finish_reason: string
  }[]
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export class OpenRouterClient {
  private apiKey: string
  private defaultModel: string

  constructor(apiKey: string, defaultModel: string = "anthropic/claude-3-haiku") {
    this.apiKey = apiKey
    this.defaultModel = defaultModel
  }

  async generateText(
    messages: OpenRouterMessage[],
    options: OpenRouterOptions = {},
  ): Promise<string | null> {
    if (!this.apiKey) {
      logger.warn("OpenRouter API key not configured, skipping LLM call")
      return null
    }

    const model = options.model ?? this.defaultModel
    const maxTokens = options.maxTokens ?? 100
    const temperature = options.temperature ?? 0.3

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    try {
      const response = await fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://threa.app",
          "X-Title": "Threa",
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const error = await response.text()
        logger.error({ status: response.status, error }, "OpenRouter API error")
        return null
      }

      const data = (await response.json()) as OpenRouterResponse

      if (!data.choices?.[0]?.message?.content) {
        logger.warn({ data }, "OpenRouter returned no content")
        return null
      }

      return data.choices[0].message.content.trim()
    } catch (error) {
      logger.error({ error }, "OpenRouter request failed")
      return null
    } finally {
      clearTimeout(timeout)
    }
  }
}

