import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { ChatOpenAI } from "@langchain/openai"
import type { LanguageModel } from "ai"
import { logger } from "../logger"

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings"

const SUPPORTED_PROVIDERS = ["openrouter"] as const

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number]

export interface ProviderRegistryConfig {
  openrouter?: {
    apiKey: string
  }
}

interface EmbeddingResponse {
  data: Array<{
    embedding: number[]
    index: number
  }>
  model: string
  usage: {
    prompt_tokens: number
    total_tokens: number
  }
}

/**
 * Registry for AI providers. Parses provider:model strings and returns
 * model instances for both AI SDK (stream naming) and LangChain (companion agent).
 */
export class ProviderRegistry {
  private openRouterClient: ReturnType<typeof createOpenRouter> | null = null
  private openRouterApiKey: string | null = null

  constructor(config: ProviderRegistryConfig) {
    if (config.openrouter?.apiKey) {
      this.openRouterClient = createOpenRouter({
        apiKey: config.openrouter.apiKey,
      })
      this.openRouterApiKey = config.openrouter.apiKey
    }
  }

  /**
   * Parse a provider:model string into its components.
   * Format: "provider:model_id"
   * Examples:
   *   "openrouter:anthropic/claude-sonnet-4.5" -> { provider: "openrouter", modelId: "anthropic/claude-sonnet-4.5" }
   *   "openrouter:anthropic/claude-3-haiku" -> { provider: "openrouter", modelId: "anthropic/claude-3-haiku" }
   */
  parseProviderModel(providerModelString: string): {
    provider: string
    modelId: string
  } {
    const colonIndex = providerModelString.indexOf(":")
    if (colonIndex === -1) {
      throw new Error(`Invalid provider:model format: "${providerModelString}". Expected format: "provider:model_id"`)
    }

    const provider = providerModelString.slice(0, colonIndex)
    const modelId = providerModelString.slice(colonIndex + 1)

    if (!provider || !modelId) {
      throw new Error(
        `Invalid provider:model format: "${providerModelString}". Both provider and model_id are required.`
      )
    }

    return { provider, modelId }
  }

  /**
   * Get an AI SDK language model from a provider:model string.
   * Used by stream-naming-service for generateText().
   */
  getModel(providerModelString: string): LanguageModel {
    const { provider, modelId } = this.parseProviderModel(providerModelString)

    switch (provider) {
      case "openrouter":
        return this.getOpenRouterModel(modelId)
      default:
        throw new Error(`Unsupported provider: "${provider}". Supported providers: ${SUPPORTED_PROVIDERS.join(", ")}`)
    }
  }

  /**
   * Get a LangChain ChatModel from a provider:model string.
   * Used by companion agent for LangGraph.
   */
  getLangChainModel(providerModelString: string): ChatOpenAI {
    const { provider, modelId } = this.parseProviderModel(providerModelString)

    switch (provider) {
      case "openrouter":
        return this.getLangChainOpenRouterModel(modelId)
      default:
        throw new Error(`Unsupported provider: "${provider}". Supported providers: ${SUPPORTED_PROVIDERS.join(", ")}`)
    }
  }

  private getOpenRouterModel(modelId: string): LanguageModel {
    if (!this.openRouterClient) {
      throw new Error("OpenRouter is not configured. Set OPENROUTER_API_KEY environment variable.")
    }

    logger.debug({ provider: "openrouter", modelId }, "Creating AI SDK model instance")
    return this.openRouterClient.chat(modelId)
  }

  private getLangChainOpenRouterModel(modelId: string): ChatOpenAI {
    if (!this.openRouterApiKey) {
      throw new Error("OpenRouter is not configured. Set OPENROUTER_API_KEY environment variable.")
    }

    logger.debug({ provider: "openrouter", modelId }, "Creating LangChain model instance")
    return new ChatOpenAI({
      model: modelId,
      apiKey: this.openRouterApiKey,
      configuration: {
        baseURL: OPENROUTER_BASE_URL,
      },
    })
  }

  /**
   * Generate embedding for a single text using the specified provider:model.
   */
  async embed(providerModelString: string, text: string): Promise<number[]> {
    const embeddings = await this.embedBatch(providerModelString, [text])
    return embeddings[0]
  }

  /**
   * Generate embeddings for multiple texts in a single request.
   */
  async embedBatch(providerModelString: string, texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return []
    }

    const { provider, modelId } = this.parseProviderModel(providerModelString)

    switch (provider) {
      case "openrouter":
        return this.getOpenRouterEmbeddings(modelId, texts)
      default:
        throw new Error(
          `Unsupported embedding provider: "${provider}". Supported providers: ${SUPPORTED_PROVIDERS.join(", ")}`
        )
    }
  }

  private async getOpenRouterEmbeddings(modelId: string, texts: string[]): Promise<number[][]> {
    if (!this.openRouterApiKey) {
      throw new Error("OpenRouter is not configured. Set OPENROUTER_API_KEY environment variable.")
    }

    logger.debug({ provider: "openrouter", modelId, count: texts.length }, "Generating embeddings")

    const response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.openRouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://threa.app",
        "X-Title": "Threa",
      },
      body: JSON.stringify({
        model: modelId,
        input: texts,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error({ status: response.status, error: errorText, modelId }, "OpenRouter embedding request failed")
      throw new Error(`OpenRouter embedding request failed: ${response.status} - ${errorText}`)
    }

    const data = (await response.json()) as EmbeddingResponse

    // Sort by index to ensure correct order
    const sorted = data.data.sort((a, b) => a.index - b.index)
    return sorted.map((item) => item.embedding)
  }
}
