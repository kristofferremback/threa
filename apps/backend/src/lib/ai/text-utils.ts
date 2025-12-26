/**
 * AI text processing utilities.
 */

/**
 * Strip markdown code fences from LLM output.
 * Models sometimes wrap JSON in ```json ... ``` even when asked not to.
 *
 * Handles:
 * - Leading whitespace before opening fence
 * - ```json or plain ```
 * - Missing closing fence
 *
 * Used with AI SDK's experimental_repairText option:
 * @example
 * generateObject({
 *   model,
 *   schema,
 *   prompt,
 *   experimental_repairText: stripMarkdownFences,
 * })
 */
export async function stripMarkdownFences({ text }: { text: string }): Promise<string> {
  return text
    .replace(/^\s*```(?:json)?\s*\n?/i, "") // Opening fence with any leading whitespace
    .replace(/\n?```\s*$/i, "") // Closing fence if present
    .trim()
}
