/**
 * AI text processing utilities.
 */

/**
 * Convert snake_case to camelCase.
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

/**
 * Semantic field mappings for when LLMs use different but equivalent field names.
 * Maps from model's field name to expected schema field name and optional value transform.
 */
const SEMANTIC_FIELD_MAPPINGS: Record<string, { field: string; transform?: (v: unknown) => unknown }> = {
  // "classification: not_knowledge_worthy" → "isKnowledgeWorthy: false"
  classification: {
    field: "isKnowledgeWorthy",
    transform: (v) => typeof v === "string" && !v.toLowerCase().includes("not"),
  },
  // "recommendation: do_not_preserve" → we don't need this field, but don't want it to fail
  recommendation: { field: "_recommendation" },
}

/**
 * Recursively convert all snake_case keys in an object to camelCase,
 * and apply semantic field mappings.
 */
function normalizeObject(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(normalizeObject)
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      // Check for semantic mapping first
      const mapping = SEMANTIC_FIELD_MAPPINGS[key]
      if (mapping) {
        const transformedValue = mapping.transform ? mapping.transform(value) : value
        result[mapping.field] = normalizeObject(transformedValue)
      } else {
        // Convert snake_case to camelCase
        result[snakeToCamel(key)] = normalizeObject(value)
      }
    }
    return result
  }
  return obj
}

/**
 * Strip markdown code fences and normalize JSON field names.
 *
 * Handles common LLM output issues:
 * - Markdown code fences (```json ... ```)
 * - snake_case field names instead of camelCase
 * - Semantic field name variations (e.g., "classification" → "isKnowledgeWorthy")
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
  // Strip markdown fences
  let cleaned = text
    .replace(/^\s*```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim()

  // Try to parse and normalize field names
  try {
    const parsed = JSON.parse(cleaned)
    const normalized = normalizeObject(parsed)
    return JSON.stringify(normalized)
  } catch {
    // If parsing fails, return the cleaned text as-is
    return cleaned
  }
}
