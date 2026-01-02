/**
 * AI text processing utilities.
 */

import { Message } from "../../repositories/message-repository"

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
    const normalized = normalizeObject(parsed) as Record<string, unknown>
    const withDefaults = addDefaults(normalized)
    return JSON.stringify(withDefaults)
  } catch {
    // If parsing fails, return the cleaned text as-is
    return cleaned
  }
}

/**
 * Format a message for use in a prompt as a structured message.
 *
 * @example
 * formatMessage({
 *   authorType: "user",
 *   authorId: "123",
 *   content: "Hello, world!",
 *   createdAt: "2021-01-01T00:00:00Z",
 * })
 * // <message authorType="user" authorId="123" createdAt="2021-01-01T00:00:00Z">Hello, world!</message>
 */
export function formatMessage(m: Message): string {
  // TODO: Enrich the message with the author name (user, persona)
  // Note for future self: we need to add timezone local time formatting in here.
  return `<message authorType="${m.authorType}" authorId="${m.authorId}" createdAt="${m.createdAt}">${m.content}</message>`
}

/**
 * Format a list of messages for use in a prompt as a structured list of messages.
 *
 * @example
 * formatMessages([{
 *   authorType: "user",
 *   authorId: "123",
 *   content: "Hello, world!",
 *   createdAt: "2021-01-01T00:00:00Z",
 * }, {
 *   authorType: "persona",
 *   authorId: "456",
 *   content: "Hello, world!",
 *   createdAt: "2021-01-01T00:00:01Z",
 * }])
 * // <messages>
 * // <message authorType="user" authorId="123" createdAt="2021-01-01T00:00:00Z">Hello, world!</message>
 * // <message authorType="persona" authorId="456" createdAt="2021-01-01T00:00:01Z">Hello, world!</message>
 * // </messages>
 */
export function formatMessages(messages: Message[]): string {
  return `<messages>${messages.map((m) => formatMessage(m)).join("\n")}</messages>`
}
