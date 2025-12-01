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
import { ANTHROPIC_API_KEY, OPENAI_API_KEY } from "../config"

export type Provider = "ollama" | "openai" | "anthropic"

export interface LLMVerificationResult {
  isSameTopic: boolean
  relationship: "identical" | "same_topic" | "related" | "different"
  explanation: string
  model: string
  provider: Provider
  latencyMs: number
  rawResponse?: string
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
      temperature: 0.1,
    }
  }

  if (parts[0] === "anthropic") {
    return {
      provider: "anthropic",
      model: parts.slice(1).join(":"),
      temperature: 0.1,
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
 */
const AVAILABLE_MODELS: Record<Provider, string[]> = {
  ollama: ["granite4:350m", "granite4", "gemma3:1b", "gemma3:12b", "deepseek-r1:8b"],
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"],
  anthropic: ["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest"],
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
    const content =
      response.content[0]?.type === "text" ? response.content[0].text.trim() : ""

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
    }
  }
}

/**
 * Create error result.
 */
function errorResult(err: unknown, config: ModelConfig, latencyMs: number): LLMVerificationResult {
  return {
    isSameTopic: false,
    relationship: "different",
    explanation: `Error: ${err instanceof Error ? err.message : String(err)}`,
    model: config.model,
    provider: config.provider,
    latencyMs,
  }
}

// Legacy exports for backward compatibility
export function getModelConfig(modelString: string): ModelConfig {
  return parseModelString(modelString)
}
