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
 * Add default values for common missing fields.
 * The AI SDK validates before applying Zod defaults, so we must add them here.
 */
function addDefaults(obj: Record<string, unknown>): Record<string, unknown> {
  // For message classification: if isGem is false, knowledgeType should be null
  if ("isGem" in obj && obj.isGem === false) {
    if (!("knowledgeType" in obj)) {
      obj.knowledgeType = null
    }
  }

  // Message classification often omits reasoning when isGem is false; default to null
  if ("isGem" in obj && !("reasoning" in obj)) {
    obj.reasoning = null
  }

  // Default confidence if missing
  if (!("confidence" in obj)) {
    obj.confidence = 0.5
  }

  // For conversation classification: add defaults for boolean fields
  if ("isKnowledgeWorthy" in obj) {
    if (!("shouldReviseExisting" in obj)) {
      obj.shouldReviseExisting = false
    }
    if (!("revisionReason" in obj)) {
      obj.revisionReason = null
    }
    if (obj.isKnowledgeWorthy === false && !("knowledgeType" in obj)) {
      obj.knowledgeType = null
    }
  }

  return obj
}

/**
 * Extract the first valid JSON object from text that may have garbage prefixes.
 *
 * Some models output garbage before JSON like:
 * - "that.{...}"
 * - "{{...}}"  (double braces)
 * - "reason.{...}"
 * - '": true}.{...}' (fragments from previous output)
 */
function extractJsonObject(text: string): string {
  // Find the first '{' that might start valid JSON
  const firstBrace = text.indexOf("{")
  if (firstBrace === -1) return text

  // Try parsing from each '{' until we find valid JSON
  let pos = firstBrace
  while (pos < text.length) {
    const candidate = text.slice(pos)

    // Skip if we hit a double brace - try the inner one
    if (candidate.startsWith("{{") || candidate.startsWith("{ {")) {
      pos = text.indexOf("{", pos + 1)
      if (pos === -1) break
      continue
    }

    // Try to find matching closing brace by counting
    let depth = 0
    let inString = false
    let escape = false
    let end = -1

    for (let i = 0; i < candidate.length; i++) {
      const char = candidate[i]

      if (escape) {
        escape = false
        continue
      }

      if (char === "\\") {
        escape = true
        continue
      }

      if (char === '"') {
        inString = !inString
        continue
      }

      if (inString) continue

      if (char === "{") depth++
      if (char === "}") {
        depth--
        if (depth === 0) {
          end = i + 1
          break
        }
      }
    }

    if (end > 0) {
      const extracted = candidate.slice(0, end)
      try {
        JSON.parse(extracted)
        return extracted
      } catch {
        // Not valid JSON, try next brace
      }
    }

    // Find next '{' to try
    const nextBrace = text.indexOf("{", pos + 1)
    if (nextBrace === -1) break
    pos = nextBrace
  }

  // Couldn't extract valid JSON, return original
  return text
}

/**
 * Strip markdown code fences and normalize JSON field names.
 *
 * Handles common LLM output issues:
 * - Garbage prefixes before JSON (e.g., "that.{...}")
 * - Double braces (e.g., "{{...}}")
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

  // Extract JSON object from garbage prefixes
  cleaned = extractJsonObject(cleaned)

  // Try to parse and normalize field names
  try {
    const parsed = JSON.parse(cleaned)
    const normalized = normalizeObject(parsed) as Record<string, unknown>
    const withDefaults = addDefaults(normalized)
    return JSON.stringify(withDefaults)
  } catch {
    // If parsing fails, return the cleaned text as-is
    return cleaned
  }
}
