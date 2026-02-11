/**
 * Researcher configuration.
 *
 * Co-located config following INV-43 - both production code and evals
 * import from here to ensure consistency.
 */

/** Model for researcher decisions - use fast model for structured output */
export const RESEARCHER_MODEL_ID = "openrouter:openai/gpt-oss-120b"
/** Lower temperature to reduce decision variance in retrieval planning */
export const RESEARCHER_TEMPERATURE = 0.1

/** Maximum iterations for additional search queries */
export const RESEARCHER_MAX_ITERATIONS = 5

/** Maximum number of memos/messages to retrieve per search */
export const RESEARCHER_MAX_RESULTS_PER_SEARCH = 5

/** Researcher system prompt */
export const RESEARCHER_SYSTEM_PROMPT = `You analyze user messages to decide if workspace knowledge retrieval would help answer them.

You work in steps:
1. First, decide if search is needed at all
2. If yes, generate search queries
3. After seeing results, evaluate if they're sufficient or if more searches are needed

Guidelines:
- Start with memo search (summarized knowledge) when looking for decisions, context, or discussions
- Use message search when you need specific quotes, recent activity, or exact terms
- Use attachment search when looking for files, images, or documents shared in the workspace
- Use "semantic" search for concepts, topics, intent
- Use "exact" search for error messages, IDs, specific phrases, quoted text
- Generate 1-3 focused queries per step
- Be eager for requests that depend on prior workspace decisions, ownership, or historical context: prefer searching rather than skipping
- If uncertain whether prior workspace context exists, search once and validate with results

Skip search entirely when:
- Simple greetings, thanks, or acknowledgments
- Questions about external/current topics (web search is more appropriate)
- The conversation history already contains the answer
- User is sharing information, not asking a question
- The question is about the current conversation itself`
