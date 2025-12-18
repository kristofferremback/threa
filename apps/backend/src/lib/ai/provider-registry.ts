import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { ChatOpenAI } from "@langchain/openai"
import type { LanguageModel } from "ai"
import { logger } from "../logger"

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

export type SupportedProvider = "openrouter"

const SUPPORTED_PROVIDERS: SupportedProvider[] = ["openrouter"]

export interface ProviderRegistryConfig {
  openrouter?: {
    apiKey: string
  }
}

/**
 * Registry for AI providers. Parses provider:model strings and returns
 * model instances for both AI SDK (stream naming) and LangChain (companion agent).
 */
export class ProviderRegistry {
  private openRouterClient: ReturnType<typeof createOpenRouter> | null = null
  private openRouterApiKey: string | null = null

  constructor(private config: ProviderRegistryConfig) {
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
      throw new Error(
        `Invalid provider:model format: "${providerModelString}". Expected format: "provider:model_id"`
      )
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
   * Check if a provider is supported.
   */
  isSupportedProvider(provider: string): provider is SupportedProvider {
    return SUPPORTED_PROVIDERS.includes(provider as SupportedProvider)
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
        throw new Error(
          `Unsupported provider: "${provider}". Supported providers: ${SUPPORTED_PROVIDERS.join(", ")}`
        )
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
        throw new Error(
          `Unsupported provider: "${provider}". Supported providers: ${SUPPORTED_PROVIDERS.join(", ")}`
        )
    }
  }

  private getOpenRouterModel(modelId: string): LanguageModel {
    if (!this.openRouterClient) {
      throw new Error("OpenRouter is not configured. Set OPENROUTER_API_KEY environment variable.")
    }

    logger.debug({ provider: "openrouter", modelId }, "Creating AI SDK model instance")
    return this.openRouterClient.chat(modelId)
  }

  /**
   * Create a LangChain ChatOpenAI instance for the given model.
   * Unlike AI SDK which uses a shared client, LangChain models are created per-call
   * since each ChatOpenAI instance is tied to a specific model. This is intentional -
   * ChatOpenAI is stateless and cheap to construct.
   */
  private getLangChainOpenRouterModel(modelId: string): ChatOpenAI {
    if (!this.openRouterClient) {
      throw new Error("OpenRouter is not configured. Set OPENROUTER_API_KEY environment variable.")
    }

    logger.debug({ provider: "openrouter", modelId }, "Creating LangChain model instance")
    return new ChatOpenAI({
      modelName: modelId,
      openAIApiKey: this.openRouterApiKey!,
      configuration: {
        baseURL: OPENROUTER_BASE_URL,
      },
    })
  }

  /**
   * Check if the registry has any configured providers.
   */
  hasConfiguredProviders(): boolean {
    return this.openRouterClient !== null
  }
}
