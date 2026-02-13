/**
 * Workspace agent configuration.
 *
 * Co-located config following INV-43 - both production code and evals
 * import from here to ensure consistency.
 */

/** Model for workspace agent retrieval planning - use fast model for structured output */
export const WORKSPACE_AGENT_MODEL_ID = "openrouter:openai/gpt-oss-120b"
/** Lower temperature to reduce decision variance in retrieval planning */
export const WORKSPACE_AGENT_TEMPERATURE = 0.1

/** Maximum iterations for additional search queries */
export const WORKSPACE_AGENT_MAX_ITERATIONS = 5

/** Maximum number of memos/messages to retrieve per search */
export const WORKSPACE_AGENT_MAX_RESULTS_PER_SEARCH = 5

/** Workspace agent system prompt */
export const WORKSPACE_AGENT_SYSTEM_PROMPT = `You are a workspace retrieval agent. Given a query, break it down into targeted search queries across memos, messages, and attachments.

You work in steps:
1. Generate search queries to find relevant workspace knowledge
2. After seeing results, evaluate if they're sufficient or if more searches are needed

Guidelines:
- Start with memo search (summarized knowledge) when looking for decisions, context, or discussions
- Use message search when you need specific quotes, recent activity, or exact terms
- Use attachment search when looking for files, images, or documents shared in the workspace
- Use "semantic" search for concepts, topics, intent
- Use "exact" search for error messages, IDs, specific phrases, quoted text
- Generate 1-3 focused queries per step
- Be eager for requests that depend on prior workspace decisions, ownership, or historical context: prefer searching rather than skipping
- If uncertain whether prior workspace context exists, search once and validate with results`
