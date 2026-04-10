/**
 * Workspace agent configuration.
 *
 * Co-located config following INV-43 - both production code and evals
 * import from here to ensure consistency.
 */

/**
 * Model for workspace agent retrieval planning / evaluation.
 *
 * Chosen for fast, predictable latency and solid structured-output compliance.
 * The previous `gpt-oss-120b` choice via OpenRouter was cheap but its patchwork
 * provider backing meant tail latency ran into the 60–120s range on some calls,
 * which fed directly into the "30 minute workspace research" demo failure mode.
 * Haiku 4.5 is the Anthropic cost-effective tier and remains on a single reliable
 * provider path.
 */
export const WORKSPACE_AGENT_MODEL_ID = "openrouter:anthropic/claude-haiku-4.5"
/** Lower temperature to reduce decision variance in retrieval planning */
export const WORKSPACE_AGENT_TEMPERATURE = 0.1

/**
 * Maximum iterations for the plan→execute→evaluate→iterate loop.
 *
 * Two is the GAM sweet spot: one initial plan+search, plus one optional refinement
 * when the evaluator finds a specific gap. Dropping to one iteration would remove
 * the "deep" in deep research (no refinement at all); keeping five as before
 * compounds wall-clock cost too aggressively when the evaluator over-iterates.
 */
export const WORKSPACE_AGENT_MAX_ITERATIONS = 2

/** Maximum number of memos/messages to retrieve per search */
export const WORKSPACE_AGENT_MAX_RESULTS_PER_SEARCH = 5

/**
 * Maximum number of additional queries the evaluator is allowed to request
 * after iteration 1. Caps the worst-case iteration-2 fan-out.
 */
export const WORKSPACE_AGENT_MAX_ADDITIONAL_QUERIES = 3

/**
 * Hard wall-clock budget for a single workspace_research tool call in milliseconds.
 *
 * When exceeded the researcher returns whatever partial results it has accumulated
 * (`partial: true, partialReason: "timeout"`). The agent loop uses those partial
 * results to continue and produce a response — the session is NOT killed.
 */
export const WORKSPACE_AGENT_TOTAL_BUDGET_MS = 45_000

/** Per-call timeout for the planner LLM. Fails over to baseline queries on timeout. */
export const WORKSPACE_AGENT_PLANNER_TIMEOUT_MS = 20_000

/** Per-call timeout for the evaluator LLM. Treated as "sufficient" on timeout. */
export const WORKSPACE_AGENT_EVALUATOR_TIMEOUT_MS = 15_000

/** Per-call timeout for embedding generation. */
export const WORKSPACE_AGENT_EMBED_TIMEOUT_MS = 10_000

/** Workspace agent system prompt */
export const WORKSPACE_AGENT_SYSTEM_PROMPT = `You are a workspace retrieval agent. Given a query, produce a small, targeted set of search queries across memos, messages, and attachments, then judge whether the results answer the query.

Process:
1. Plan 1–3 focused queries. Fewer is better when one strong query will do.
2. After seeing results, decide sufficient vs. not. Default to sufficient=true — only ask for more queries when the results clearly fail to address the core of the query AND you have a specific narrower query likely to succeed.

Guidelines:
- target "memos": summarized knowledge (decisions, context, discussions).
- target "messages": specific quotes, recent activity, exact terms.
- target "attachments": files, images, documents.
- type "semantic": concepts, topics, intent.
- type "exact": error messages, IDs, quoted phrases.

The caller has already decided that workspace retrieval is warranted. Do not second-guess the invocation — produce queries.`
