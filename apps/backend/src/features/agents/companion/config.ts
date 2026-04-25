import { BUILT_IN_AGENTS, ARIADNE_AGENT_ID } from "../built-in-agents"

// Default model for companion responses
export const COMPANION_MODEL_ID = BUILT_IN_AGENTS[ARIADNE_AGENT_ID].model

// Temperature for response generation
export const COMPANION_TEMPERATURE = BUILT_IN_AGENTS[ARIADNE_AGENT_ID].temperature ?? 0.7

// Model for rolling long-context summaries of dropped history
export const COMPANION_SUMMARY_MODEL_ID = "openrouter:anthropic/claude-haiku-4.5"

// Lower temperature for deterministic summary updates
export const COMPANION_SUMMARY_TEMPERATURE = 0.1
