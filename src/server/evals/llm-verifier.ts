/**
 * LLM verification for evals.
 *
 * Calls real LLMs to verify topic similarity.
 * Supports multiple providers: ollama, openai, anthropic.
 *
 * Model naming convention:
 *   ollama:granite4:350m
 *   openai:gpt-4o-mini
 *   anthropic:claude-3-5-haiku-latest
 */

import ollama from "ollama"
import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY } from "../config"

export type Provider = "ollama" | "openai" | "anthropic" | "openrouter"

export interface LLMVerificationResult {
  isSameTopic: boolean
  relationship: "identical" | "same_topic" | "related" | "different"
  explanation: string
  model: string
  provider: Provider
  latencyMs: number
  rawResponse: string | null
  parsedResponse: Record<string, any> | null
}

export interface ModelConfig {
  provider: Provider
  model: string
  temperature?: number
}

/**
 * Parse model string into provider and model name.
 * Format: provider:model (e.g., "ollama:granite4:350m", "openai:gpt-4o-mini")
 * Default provider is "ollama" if not specified.
 */
export function parseModelString(modelString: string): ModelConfig {
  const parts = modelString.split(":")

  if (parts[0] === "ollama") {
    return {
      provider: "ollama",
      model: parts.slice(1).join(":"),
      temperature: 0.1,
    }
  }

  if (parts[0] === "openai") {
    return {
      provider: "openai",
      model: parts.slice(1).join(":"),
      temperature: 1,
    }
  }

  if (parts[0] === "anthropic") {
    return {
      provider: "anthropic",
      model: parts.slice(1).join(":"),
      temperature: 0.1,
    }
  }

  if (parts[0] === "openrouter") {
    return {
      provider: "openrouter",
      model: parts.slice(1).join("/"), // OpenRouter uses slashes: ibm/granite-3.1-8b-instruct
      temperature: 0.7,
    }
  }

  // Default to ollama if no provider prefix
  return {
    provider: "ollama",
    model: modelString,
    temperature: 0.1,
  }
}

/**
 * Available models by provider.
 * Uses the exact model names to match ai-providers.ts.
 */
const AVAILABLE_MODELS: Record<Provider, string[]> = {
  ollama: ["granite4:350m", "granite4:1b", "gemma3:1b", "deepseek-r1:1.5b", "qwen3:0.6b", "qwen3:1.7b"],
  openai: ["gpt-5-nano", "gpt-5-mini", "gpt-5"],
  anthropic: [
    "claude-3-5-haiku-20241022",
    "claude-3-haiku-20240307",
    "claude-haiku-4-5-20251001",
    "claude-sonnet-4-5-20250929",
  ],
  openrouter: [
    // IBM Granite models
    "ibm:granite-3.1-8b-instruct",
    "ibm:granite-3.3-8b-instruct",
    // Google Gemma
    "google:gemma-3-4b-it",
    "google:gemma-3-12b-it",
    // Qwen
    "qwen:qwen3-8b",
    "qwen:qwen3-14b",
    // DeepSeek
    "deepseek:deepseek-chat-v3-0324",
    "deepseek:deepseek-r1",
    // Anthropic via OpenRouter
    "anthropic:claude-3.5-haiku",
    "anthropic:claude-sonnet-4",
  ],
}

/**
 * Get all available models with provider prefix.
 */
export function getAvailableModels(): string[] {
  const models: string[] = []

  for (const [provider, providerModels] of Object.entries(AVAILABLE_MODELS)) {
    for (const model of providerModels) {
      models.push(`${provider}:${model}`)
    }
  }

  return models
}

/**
 * Check which providers are configured (have API keys).
 */
export function getConfiguredProviders(): Provider[] {
  const providers: Provider[] = ["ollama"] // Always available locally

  if (OPENAI_API_KEY) {
    providers.push("openai")
  }

  if (ANTHROPIC_API_KEY) {
    providers.push("anthropic")
  }

  if (OPENROUTER_API_KEY) {
    providers.push("openrouter")
  }

  return providers
}

/**
 * Get available models for configured providers only.
 */
export function getConfiguredModels(): string[] {
  const providers = getConfiguredProviders()
  return getAvailableModels().filter((m) => {
    const config = parseModelString(m)
    return providers.includes(config.provider)
  })
}

const VERIFICATION_PROMPT = `Compare these two pieces of content and determine if they're about the same topic.

EXISTING MEMO SUMMARY:
{existingSummary}

NEW MESSAGE:
{newContent}

Respond with JSON only (no markdown):
{"same_topic": boolean, "relationship": "identical" | "same_topic" | "related" | "different", "explanation": "brief reasoning (max 50 words)"}

Guidelines:
- "identical": Essentially the same information
- "same_topic": About the same subject, may add new details
- "related": Connected but discussing distinct aspects
- "different": Unrelated topics`

/**
 * Verify if two pieces of content are about the same topic using an LLM.
 */
export async function verifyWithLLM(
  newContent: string,
  existingSummary: string,
  modelString: string = "ollama:granite4:350m",
): Promise<LLMVerificationResult> {
  const config = parseModelString(modelString)
  const prompt = VERIFICATION_PROMPT.replace("{existingSummary}", existingSummary).replace(
    "{newContent}",
    newContent.slice(0, 1000),
  )

  switch (config.provider) {
    case "ollama":
      return verifyWithOllama(prompt, config)
    case "openai":
      return verifyWithOpenAI(prompt, config)
    case "anthropic":
      return verifyWithAnthropic(prompt, config)
    case "openrouter":
      return verifyWithOpenRouter(prompt, config)
    default:
      throw new Error(`Unknown provider: ${config.provider}`)
  }
}

/**
 * Verify using Ollama.
 */
async function verifyWithOllama(prompt: string, config: ModelConfig): Promise<LLMVerificationResult> {
  const start = performance.now()

  try {
    const response = await ollama.chat({
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      options: { temperature: config.temperature ?? 0.1 },
    })

    const latencyMs = performance.now() - start
    const content = response.message.content.trim()

    return parseResponse(content, config, latencyMs)
  } catch (err) {
    return errorResult(err, config, performance.now() - start)
  }
}

/**
 * Verify using OpenAI.
 */
async function verifyWithOpenAI(prompt: string, config: ModelConfig): Promise<LLMVerificationResult> {
  if (!OPENAI_API_KEY) {
    return {
      isSameTopic: false,
      relationship: "different",
      explanation: "OpenAI API key not configured",
      model: config.model,
      provider: config.provider,
      latencyMs: 0,
      rawResponse: null,
      parsedResponse: null,
    }
  }

  const client = new OpenAI({ apiKey: OPENAI_API_KEY })
  const start = performance.now()

  try {
    const response = await client.chat.completions.create({
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      temperature: config.temperature ?? 0.1,
    })

    const latencyMs = performance.now() - start
    const content = response.choices[0]?.message?.content?.trim() || ""

    return parseResponse(content, config, latencyMs)
  } catch (err) {
    return errorResult(err, config, performance.now() - start)
  }
}

/**
 * Verify using Anthropic.
 */
async function verifyWithAnthropic(prompt: string, config: ModelConfig): Promise<LLMVerificationResult> {
  if (!ANTHROPIC_API_KEY) {
    return {
      isSameTopic: false,
      relationship: "different",
      explanation: "Anthropic API key not configured",
      model: config.model,
      provider: config.provider,
      latencyMs: 0,
      rawResponse: null,
      parsedResponse: null,
    }
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  const start = performance.now()

  try {
    const response = await client.messages.create({
      model: config.model,
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    })

    const latencyMs = performance.now() - start
    const content = response.content[0]?.type === "text" ? response.content[0].text.trim() : ""

    return parseResponse(content, config, latencyMs)
  } catch (err) {
    return errorResult(err, config, performance.now() - start)
  }
}

/**
 * Verify using OpenRouter (OpenAI-compatible API).
 */
async function verifyWithOpenRouter(prompt: string, config: ModelConfig): Promise<LLMVerificationResult> {
  if (!OPENROUTER_API_KEY) {
    return {
      isSameTopic: false,
      relationship: "different",
      explanation: "OpenRouter API key not configured",
      model: config.model,
      provider: config.provider,
      latencyMs: 0,
      rawResponse: null,
      parsedResponse: null,
    }
  }

  const client = new OpenAI({
    apiKey: OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://threa.app",
      "X-Title": "Threa Evals",
    },
  })
  const start = performance.now()

  try {
    const response = await client.chat.completions.create({
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      temperature: config.temperature ?? 0.7,
    })

    const latencyMs = performance.now() - start
    const content = response.choices[0]?.message?.content?.trim() || ""

    return parseResponse(content, config, latencyMs)
  } catch (err) {
    return errorResult(err, config, performance.now() - start)
  }
}

/**
 * Parse LLM response into structured result.
 */
function parseResponse(content: string, config: ModelConfig, latencyMs: number): LLMVerificationResult {
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return {
      isSameTopic: false,
      relationship: "different",
      explanation: "Failed to parse JSON response",
      model: config.model,
      provider: config.provider,
      latencyMs,
      rawResponse: content,
      parsedResponse: null,
    }
  }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      isSameTopic: parsed.same_topic === true,
      relationship: parsed.relationship || "different",
      explanation: parsed.explanation || "",
      model: config.model,
      provider: config.provider,
      latencyMs,
      rawResponse: content,
      parsedResponse: parsed,
    }
  } catch {
    return {
      isSameTopic: false,
      relationship: "different",
      explanation: "Failed to parse JSON",
      model: config.model,
      provider: config.provider,
      latencyMs,
      rawResponse: content,
      parsedResponse: null,
    }
  }
}

/**
 * Create error result.
 */
function errorResult(err: unknown, config: ModelConfig, latencyMs: number): LLMVerificationResult {
  const errorMessage = classifyError(err)

  return {
    isSameTopic: false,
    relationship: "different",
    explanation: errorMessage,
    model: config.model,
    provider: config.provider,
    latencyMs,
    rawResponse: null,
    parsedResponse: null,
  }
}

/**
 * Classify error into user-friendly message.
 */
function classifyError(err: unknown): string {
  if (!(err instanceof Error)) {
    return `Error: ${String(err)}`
  }

  const message = err.message.toLowerCase()

  // Rate limiting
  if (message.includes("rate limit") || message.includes("429") || message.includes("too many requests")) {
    return `Rate limited: ${err.message}`
  }

  // Auth errors
  if (message.includes("401") || message.includes("403") || message.includes("unauthorized") || message.includes("invalid api key") || message.includes("authentication")) {
    return `Auth error: ${err.message}`
  }

  // Model not found
  if (message.includes("404") || message.includes("not found") || message.includes("does not exist")) {
    return `Model not found: ${err.message}`
  }

  // Timeout
  if (message.includes("timeout") || message.includes("timed out") || message.includes("deadline")) {
    return `Timeout: ${err.message}`
  }

  // Connection errors
  if (message.includes("econnrefused") || message.includes("enotfound") || message.includes("network") || message.includes("connection")) {
    return `Connection error: ${err.message}`
  }

  return `Error: ${err.message}`
}

// Legacy exports for backward compatibility
export function getModelConfig(modelString: string): ModelConfig {
  return parseModelString(modelString)
}
