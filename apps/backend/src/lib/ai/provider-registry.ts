import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type { LanguageModel } from "ai"
import { logger } from "../logger"

/**
 * Parses a provider:model string into its components.
 * Format: "provider:model_id"
 * Examples:
 *   "openrouter:anthropic/claude-sonnet-4.5" -> { provider: "openrouter", modelId: "anthropic/claude-sonnet-4.5" }
 *   "anthropic:claude-sonnet-4-20250514" -> { provider: "anthropic", modelId: "claude-sonnet-4-20250514" }
 *   "ollama:granite4:350m" -> { provider: "ollama", modelId: "granite4:350m" }
 */
export function parseProviderModel(providerModelString: string): {
  provider: string
  modelId: string
} {
  const colonIndex = providerModelString.indexOf(":")
  if (colonIndex === -1) {
    throw new Error(
      `Invalid provider:model format: "${providerModelString}". Expected format: "provider:model_id"`,
    )
  }

  const provider = providerModelString.slice(0, colonIndex)
  const modelId = providerModelString.slice(colonIndex + 1)

  if (!provider || !modelId) {
    throw new Error(
      `Invalid provider:model format: "${providerModelString}". Both provider and model_id are required.`,
    )
  }

  return { provider, modelId }
}

export type SupportedProvider = "openrouter"

const SUPPORTED_PROVIDERS: SupportedProvider[] = ["openrouter"]

export function isSupportedProvider(provider: string): provider is SupportedProvider {
  return SUPPORTED_PROVIDERS.includes(provider as SupportedProvider)
}

export interface ProviderRegistryConfig {
  openrouter?: {
    apiKey: string
  }
}

/**
 * Registry for AI providers. Parses provider:model strings and returns
 * the appropriate LanguageModelV1 instance.
 */
export class ProviderRegistry {
  private openRouterClient: ReturnType<typeof createOpenRouter> | null = null

  constructor(private config: ProviderRegistryConfig) {
    if (config.openrouter?.apiKey) {
      this.openRouterClient = createOpenRouter({
        apiKey: config.openrouter.apiKey,
      })
    }
  }

  /**
   * Get a language model from a provider:model string.
   * Returns the model instance ready for use with generateText/streamText.
   */
  getModel(providerModelString: string): LanguageModel {
    const { provider, modelId } = parseProviderModel(providerModelString)

    if (!isSupportedProvider(provider)) {
      throw new Error(
        `Unsupported provider: "${provider}". Supported providers: ${SUPPORTED_PROVIDERS.join(", ")}`,
      )
    }

    switch (provider) {
      case "openrouter":
        return this.getOpenRouterModel(modelId)
      default:
        throw new Error(`Provider "${provider}" is not implemented`)
    }
  }

  private getOpenRouterModel(modelId: string): LanguageModel {
    if (!this.openRouterClient) {
      throw new Error(
        "OpenRouter is not configured. Set OPENROUTER_API_KEY environment variable.",
      )
    }

    logger.debug({ provider: "openrouter", modelId }, "Creating model instance")
    return this.openRouterClient.chat(modelId)
  }

  /**
   * Check if the registry has any configured providers.
   */
  hasConfiguredProviders(): boolean {
    return this.openRouterClient !== null
  }
}
