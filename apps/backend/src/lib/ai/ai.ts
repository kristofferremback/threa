/**
 * AI SDK Wrapper
 *
 * Provides a clean abstraction over the Vercel AI SDK with:
 * - No `experimental_` prefixes
 * - Automatic repair for generateObject
 * - Unified `{ value, response }` return type
 * - Extended model ID parsing (extracts modelProvider)
 * - LangChain integration for LangGraph
 */

import {
  generateText as aiGenerateText,
  generateObject as aiGenerateObject,
  embed as aiEmbed,
  embedMany as aiEmbedMany,
} from "ai"
import type { Embedding, LanguageModel, EmbeddingModel } from "ai"
import type { z } from "zod"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { ChatOpenAI } from "@langchain/openai"
import { stripMarkdownFences } from "./text-utils"
import { logger } from "../logger"

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ParsedModel {
  /** The provider (e.g., "openrouter", "anthropic") */
  provider: string
  /** The full model ID after the provider prefix (e.g., "anthropic/claude-haiku-4.5") */
  modelId: string
  /** The model's provider extracted from modelId path, or same as provider for direct APIs */
  modelProvider: string
  /** The model name without provider path (e.g., "claude-haiku-4.5") */
  modelName: string
}

export interface AIConfig {
  openrouter?: { apiKey: string }
  defaults?: {
    repair?: RepairFunction
  }
}

export interface TelemetryConfig {
  functionId: string
  metadata?: Record<string, string | number | boolean | undefined>
}

export interface GenerateTextOptions {
  model: string
  prompt: string
  system?: string
  maxTokens?: number
  temperature?: number
  telemetry?: TelemetryConfig
}

export interface GenerateObjectOptions<T extends z.ZodType> {
  model: string
  schema: T
  prompt: string
  system?: string
  maxTokens?: number
  temperature?: number
  /** Set to false to disable repair, or provide custom repair function */
  repair?: RepairFunction | false
  telemetry?: TelemetryConfig
}

export interface EmbedOptions {
  model: string
  value: string
  telemetry?: TelemetryConfig
}

export interface EmbedManyOptions {
  model: string
  values: string[]
  telemetry?: TelemetryConfig
}

// Response types from AI SDK
type GenerateTextResponse = Awaited<ReturnType<typeof aiGenerateText>>
type EmbedResponse = Awaited<ReturnType<typeof aiEmbed>>
type EmbedManyResponse = Awaited<ReturnType<typeof aiEmbedMany>>

export interface TextResult {
  value: string
  response: GenerateTextResponse
}

export interface ObjectResult<T> {
  value: T
  response: {
    usage: {
      readonly promptTokens?: number
      readonly completionTokens?: number
      readonly totalTokens?: number
    }
  }
}

export interface SingleEmbedResult {
  value: Embedding
  response: EmbedResponse
}

export interface ManyEmbedResult {
  value: Embedding[]
  response: EmbedManyResponse
}

export type RepairFunction = (args: { text: string }) => Promise<string> | string

export interface AI {
  // Generation
  generateText(options: GenerateTextOptions): Promise<TextResult>
  generateObject<T extends z.ZodType>(options: GenerateObjectOptions<T>): Promise<ObjectResult<z.infer<T>>>

  // Embeddings
  embed(options: EmbedOptions): Promise<SingleEmbedResult>
  embedMany(options: EmbedManyOptions): Promise<ManyEmbedResult>

  // Model access (for advanced use cases)
  getLanguageModel(modelString: string): LanguageModel
  getEmbeddingModel(modelString: string): EmbeddingModel<string>
  getLangChainModel(modelString: string): ChatOpenAI

  // Parsing
  parseModel(modelString: string): ParsedModel
}

// -----------------------------------------------------------------------------
// Model ID Parsing
// -----------------------------------------------------------------------------

/**
 * Parse a provider:model string into its components.
 *
 * Format: "provider:modelPath"
 *
 * Examples:
 *   "openrouter:anthropic/claude-haiku-4.5" → {
 *     provider: "openrouter",
 *     modelId: "anthropic/claude-haiku-4.5",
 *     modelProvider: "anthropic",
 *     modelName: "claude-haiku-4.5"
 *   }
 *
 *   "anthropic:claude-sonnet-4-20250514" → {
 *     provider: "anthropic",
 *     modelId: "claude-sonnet-4-20250514",
 *     modelProvider: "anthropic",
 *     modelName: "claude-sonnet-4-20250514"
 *   }
 */
export function parseModelId(providerModelString: string): ParsedModel {
  const colonIndex = providerModelString.indexOf(":")
  if (colonIndex === -1) {
    throw new Error(`Invalid provider:model format: "${providerModelString}". Expected format: "provider:model_id"`)
  }

  const provider = providerModelString.slice(0, colonIndex)
  const modelId = providerModelString.slice(colonIndex + 1)

  if (!provider || !modelId) {
    throw new Error(`Invalid provider:model format: "${providerModelString}". Both provider and model_id are required.`)
  }

  // Extract modelProvider from modelId if it contains a path separator
  let modelProvider = provider
  let modelName = modelId

  if (modelId.includes("/")) {
    const slashIndex = modelId.indexOf("/")
    modelProvider = modelId.slice(0, slashIndex)
    modelName = modelId.slice(slashIndex + 1)
  }

  return { provider, modelId, modelProvider, modelName }
}

// -----------------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------------

export function createAI(config: AIConfig): AI {
  // Initialize providers
  const providers = {
    openrouter: config.openrouter ? createOpenRouter({ apiKey: config.openrouter.apiKey }) : null,
  }

  // Store API keys for LangChain (needs raw key, not provider instance)
  const apiKeys = {
    openrouter: config.openrouter?.apiKey ?? null,
  }

  const defaultRepair = config.defaults?.repair ?? stripMarkdownFences

  function getLanguageModel(modelString: string): LanguageModel {
    const { provider, modelId } = parseModelId(modelString)

    switch (provider) {
      case "openrouter":
        if (!providers.openrouter) {
          throw new Error("OpenRouter not configured. Set OPENROUTER_API_KEY or provide openrouter.apiKey in config.")
        }
        logger.debug({ provider, modelId }, "Creating language model instance")
        return providers.openrouter.chat(modelId)
      default:
        throw new Error(`Unsupported provider: "${provider}". Currently supported: openrouter`)
    }
  }

  function getEmbeddingModel(modelString: string): EmbeddingModel<string> {
    const { provider, modelId } = parseModelId(modelString)

    switch (provider) {
      case "openrouter":
        if (!providers.openrouter) {
          throw new Error("OpenRouter not configured. Set OPENROUTER_API_KEY or provide openrouter.apiKey in config.")
        }
        logger.debug({ provider, modelId }, "Creating embedding model instance")
        return providers.openrouter.textEmbeddingModel(modelId)
      default:
        throw new Error(`Unsupported embedding provider: "${provider}". Currently supported: openrouter`)
    }
  }

  function getLangChainModel(modelString: string): ChatOpenAI {
    const { provider, modelId } = parseModelId(modelString)

    switch (provider) {
      case "openrouter":
        if (!apiKeys.openrouter) {
          throw new Error("OpenRouter not configured. Set OPENROUTER_API_KEY or provide openrouter.apiKey in config.")
        }
        logger.debug({ provider, modelId }, "Creating LangChain model instance")
        return new ChatOpenAI({
          model: modelId,
          apiKey: apiKeys.openrouter,
          configuration: { baseURL: OPENROUTER_BASE_URL },
        })
      default:
        throw new Error(`Unsupported LangChain provider: "${provider}". Currently supported: openrouter`)
    }
  }

  function buildTelemetry(telemetry?: TelemetryConfig) {
    if (!telemetry) return undefined
    return {
      isEnabled: true,
      functionId: telemetry.functionId,
      metadata: telemetry.metadata,
    } as const
  }

  return {
    parseModel: parseModelId,
    getLanguageModel,
    getEmbeddingModel,
    getLangChainModel,

    async generateText(options) {
      const model = getLanguageModel(options.model)
      const response = await aiGenerateText({
        model,
        prompt: options.prompt,
        system: options.system,
        maxOutputTokens: options.maxTokens,
        temperature: options.temperature,
        // @ts-expect-error AI SDK telemetry types are stricter than needed; our buildTelemetry output is compatible at runtime
        experimental_telemetry: buildTelemetry(options.telemetry),
      })

      return {
        value: response.text,
        response,
      }
    },

    async generateObject<T extends z.ZodType>(options: GenerateObjectOptions<T>): Promise<ObjectResult<z.infer<T>>> {
      const model = getLanguageModel(options.model)
      const repair = options.repair === false ? undefined : (options.repair ?? defaultRepair)

      // @ts-expect-error AI SDK generateObject has complex generics; we validate schema type at our interface level
      const response = await aiGenerateObject({
        model,
        schema: options.schema,
        prompt: options.prompt,
        system: options.system,
        maxOutputTokens: options.maxTokens,
        temperature: options.temperature,
        experimental_repairText: repair,
        experimental_telemetry: buildTelemetry(options.telemetry),
      })

      return {
        value: response.object as z.infer<T>,
        response: {
          usage: response.usage,
        },
      }
    },

    async embed(options) {
      const model = getEmbeddingModel(options.model)
      const response = await aiEmbed({
        model,
        value: options.value,
        // @ts-expect-error AI SDK telemetry types are stricter than needed; our buildTelemetry output is compatible at runtime
        experimental_telemetry: buildTelemetry(options.telemetry),
      })

      return {
        value: response.embedding,
        response,
      }
    },

    async embedMany(options) {
      const model = getEmbeddingModel(options.model)
      const response = await aiEmbedMany({
        model,
        values: options.values,
        // @ts-expect-error AI SDK telemetry types are stricter than needed; our buildTelemetry output is compatible at runtime
        experimental_telemetry: buildTelemetry(options.telemetry),
      })

      return {
        value: response.embeddings,
        response,
      }
    },
  }
}
