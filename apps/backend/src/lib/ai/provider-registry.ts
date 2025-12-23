import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { ChatOpenAI } from "@langchain/openai"
import type { EmbeddingModel, LanguageModel } from "ai"
import { logger } from "../logger"

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

const SUPPORTED_PROVIDERS = ["openrouter"] as const

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number]

export interface ProviderRegistryConfig {
  openrouter?: {
    apiKey: string
  }
}

/**
 * Registry for AI providers. Parses provider:model strings and returns
 * model instances for AI SDK (chat, embedding) and LangChain (companion agent).
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
   * Get an AI SDK embedding model from a provider:model string.
   * Used with embed() and embedMany() from the AI SDK.
   */
  getEmbeddingModel(providerModelString: string): EmbeddingModel<string> {
    const { provider, modelId } = this.parseProviderModel(providerModelString)

    switch (provider) {
      case "openrouter":
        return this.getOpenRouterEmbeddingModel(modelId)
      default:
        throw new Error(
          `Unsupported embedding provider: "${provider}". Supported providers: ${SUPPORTED_PROVIDERS.join(", ")}`
        )
    }
  }

  private getOpenRouterEmbeddingModel(modelId: string): EmbeddingModel<string> {
    if (!this.openRouterClient) {
      throw new Error("OpenRouter is not configured. Set OPENROUTER_API_KEY environment variable.")
    }

    logger.debug({ provider: "openrouter", modelId }, "Creating embedding model instance")
    return this.openRouterClient.textEmbeddingModel(modelId)
  }
}
