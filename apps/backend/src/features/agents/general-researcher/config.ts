/**
 * General researcher configuration.
 *
 * Co-located config keeps production and eval/test entry points on the same
 * budgets and models (INV-44).
 */

export const GENERAL_RESEARCH_LEAD_MODEL_ID = "openrouter:anthropic/claude-haiku-4.5"
export const GENERAL_RESEARCH_RESEARCHER_MODEL_ID = "openrouter:anthropic/claude-haiku-4.5"
export const GENERAL_RESEARCH_WRITER_MODEL_ID = "openrouter:anthropic/claude-sonnet-4.5"
export const GENERAL_RESEARCH_REFERENCE_MODEL_ID = "openrouter:anthropic/claude-haiku-4.5"

export const GENERAL_RESEARCH_TEMPERATURE = 0.2
export const GENERAL_RESEARCH_WRITER_TEMPERATURE = 0.3

export const GENERAL_RESEARCH_TOTAL_BUDGET_MS = 120_000
export const GENERAL_RESEARCH_PHASE_TIMEOUT_MS = 35_000
export const GENERAL_RESEARCH_LEASE_MS = 90_000
export const GENERAL_RESEARCH_MAX_TOPICS = 4
export const GENERAL_RESEARCH_MAX_FINDINGS_PER_TOPIC = 8
export const GENERAL_RESEARCH_MAX_SOURCES = 20
export const GENERAL_RESEARCH_MAX_REPORT_CHARS = 12_000
export const GENERAL_RESEARCH_MAX_ANSWER_CHARS = 4_000

export const GENERAL_RESEARCH_SYSTEM_PROMPT = `You are Threa's general purpose researcher.

Research across available surfaces to answer the user's question directly. Prefer concise, evidence-backed answers over exhaustive reports. Use workspace context for internal decisions and history, GitHub for code/issues/PRs when connected, and web search for public/current information. If the question is under-specified in a way that would make the answer misleading, ask for clarification instead of guessing.

Keep the work bounded. Choose the smallest effort level that can answer the question well.`
