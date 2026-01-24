/**
 * Companion Agent Configuration
 *
 * Co-located config for production and evals (INV-43).
 * All companion-specific settings in one place.
 *
 * ## Configurable Components
 *
 * The companion suite supports component-level config overrides:
 *
 * - **companion**: Main agent model (response generation, tool use)
 *   Default: COMPANION_MODEL_ID (claude-sonnet-4.5)
 *
 * - **researcher**: Workspace knowledge retrieval decisions
 *   Default: RESEARCHER_MODEL_ID from researcher config (gpt-oss-120b)
 */

import { z } from "zod"

// Re-export researcher model ID for reference in eval configs
export { RESEARCHER_MODEL_ID } from "../../../src/agents/researcher/config"

// Default model for companion responses
export const COMPANION_MODEL_ID = "openrouter:anthropic/claude-sonnet-4.5"

// Temperature settings
export const COMPANION_TEMPERATURES = {
  /** Temperature for main response generation */
  response: 0.7,
  /** Temperature for evaluator judgments */
  evaluation: 0.1,
} as const

/**
 * Response schema for structured output.
 */
export const companionResponseSchema = z.object({
  /** Whether the agent should respond to this message */
  shouldRespond: z.boolean(),
  /** The response content (empty string if shouldRespond is false) */
  content: z.string(),
  /** Reasoning for the response decision */
  reasoning: z.string(),
})

export type CompanionResponse = z.infer<typeof companionResponseSchema>

/**
 * Stream types for context differentiation.
 */
export const STREAM_TYPES = ["scratchpad", "channel", "thread", "dm"] as const
export type StreamType = (typeof STREAM_TYPES)[number]

/**
 * Invocation triggers.
 */
export const INVOCATION_TRIGGERS = ["companion", "mention"] as const
export type InvocationTrigger = (typeof INVOCATION_TRIGGERS)[number]
