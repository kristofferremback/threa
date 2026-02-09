/**
 * Companion Agent Configuration
 *
 * Production config for the companion agent (INV-44).
 */

// Default model for companion responses
export const COMPANION_MODEL_ID = "openrouter:anthropic/claude-sonnet-4.5"

// Temperature for response generation
export const COMPANION_TEMPERATURE = 0.7

// Model for rolling long-context summaries of dropped history
export const COMPANION_SUMMARY_MODEL_ID = "openrouter:anthropic/claude-haiku-4.5"

// Lower temperature for deterministic summary updates
export const COMPANION_SUMMARY_TEMPERATURE = 0.1
