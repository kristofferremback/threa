/**
 * Centralized eval configuration.
 *
 * Configure models and settings via environment variables or defaults.
 * Following best practices from LLM evaluation guides:
 * - Environment-specific model versions
 * - Categorical scoring (not continuous)
 * - Cross-family judging (use different model family than generation)
 */

import { NODE_ENV } from "../config"

// Environment variable names for easy configuration
const ENV_VARS = {
  // Default eval model (used for topic classification)
  EVAL_MODEL: "EVAL_MODEL",
  // Judge model (should be different family than generation model)
  EVAL_JUDGE_MODEL: "EVAL_JUDGE_MODEL",
  // Embedding model for similarity
  EVAL_EMBEDDING_MODEL: "EVAL_EMBEDDING_MODEL",
  // Agent eval model (Ariadne)
  EVAL_AGENT_MODEL: "EVAL_AGENT_MODEL",
} as const

/**
 * Default models by environment.
 * Production should pin specific versions for reproducibility.
 */
const MODEL_DEFAULTS = {
  development: {
    // Fast local models for iteration
    evalModel: "ollama:granite4:1b",
    judgeModel: "ollama:granite4:1b",
    embeddingModel: "nomic-embed-text",
    agentModel: "anthropic:claude-haiku-4-5-20251001",
  },
  staging: {
    // Better models for pre-prod validation
    evalModel: "ollama:granite4:1b",
    judgeModel: "anthropic:claude-haiku-4-5-20251001",
    embeddingModel: "nomic-embed-text",
    agentModel: "anthropic:claude-haiku-4-5-20251001",
  },
  production: {
    // Pinned versions for reproducibility
    evalModel: "anthropic:claude-haiku-4-5-20251001",
    judgeModel: "anthropic:claude-haiku-4-5-20251001",
    embeddingModel: "nomic-embed-text",
    agentModel: "anthropic:claude-haiku-4-5-20251001",
  },
} as const

type Environment = keyof typeof MODEL_DEFAULTS

/**
 * Get the current environment, defaulting to development.
 */
function getEnvironment(): Environment {
  if (NODE_ENV === "production") return "production"
  if (NODE_ENV === "staging") return "staging"
  return "development"
}

/**
 * Get eval configuration with environment variable overrides.
 */
export function getEvalConfig() {
  const env = getEnvironment()
  const defaults = MODEL_DEFAULTS[env]

  return {
    // Models - env vars override defaults
    evalModel: process.env[ENV_VARS.EVAL_MODEL] || defaults.evalModel,
    judgeModel: process.env[ENV_VARS.EVAL_JUDGE_MODEL] || defaults.judgeModel,
    embeddingModel: process.env[ENV_VARS.EVAL_EMBEDDING_MODEL] || defaults.embeddingModel,
    agentModel: process.env[ENV_VARS.EVAL_AGENT_MODEL] || defaults.agentModel,

    // Environment info
    environment: env,
    isProduction: env === "production",
  }
}

/**
 * Print current eval configuration (useful for debugging).
 */
export function printEvalConfig() {
  const config = getEvalConfig()
  console.log(`
📋 Eval Configuration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Environment: ${config.environment}
Eval Model: ${config.evalModel}
Judge Model: ${config.judgeModel}
Embedding Model: ${config.embeddingModel}
Agent Model: ${config.agentModel}

Override with environment variables:
  EVAL_MODEL=openrouter:ibm-granite/granite-4.0-h-micro
  EVAL_JUDGE_MODEL=anthropic:claude-haiku-4-5-20251001
  EVAL_EMBEDDING_MODEL=nomic-embed-text
  EVAL_AGENT_MODEL=openrouter:google/gemma-3-12b-it
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
}

/**
 * Common model presets for quick selection.
 * Use with: EVAL_MODEL=preset:fast or --model preset:fast
 */
export const MODEL_PRESETS = {
  // Fast local models for quick iteration
  fast: "ollama:granite4:350m",
  // Better local models
  local: "ollama:granite4:1b",
  // Cheap cloud models
  cheap: "openrouter:google/gemma-3-4b-it",
  // Quality cloud models
  quality: "anthropic:claude-haiku-4-5-20251001",
  // Best quality (expensive)
  best: "anthropic:claude-sonnet-4-5-20250929",
} as const

/**
 * Resolve model string, expanding presets.
 */
export function resolveModel(modelString: string): string {
  if (modelString.startsWith("preset:")) {
    const presetName = modelString.slice(7) as keyof typeof MODEL_PRESETS
    const preset = MODEL_PRESETS[presetName]
    if (!preset) {
      throw new Error(`Unknown preset: ${presetName}. Available: ${Object.keys(MODEL_PRESETS).join(", ")}`)
    }
    return preset
  }
  return modelString
}
