/**
 * Classification evaluator for structured output field checks.
 *
 * Verifies that specific fields in structured output match expected values.
 */

import type { Evaluator, EvalContext, EvaluatorResult } from "../types"

/**
 * Options for field matching.
 */
export interface FieldMatchOptions<T> {
  /** Name for this evaluator */
  name?: string
  /** Field to check in the output */
  field: keyof T
  /** Custom comparison function (default: strict equality) */
  compare?: (actual: unknown, expected: unknown) => boolean
}

/**
 * Create a classification evaluator that checks if a field matches the expected value.
 *
 * @example
 * // Check boolean classification
 * fieldMatchEvaluator<ClassificationResult>({
 *   field: "isKnowledgeWorthy",
 * })
 *
 * // Check enum classification
 * fieldMatchEvaluator<ClassificationResult>({
 *   field: "knowledgeType",
 *   name: "knowledge-type-match",
 * })
 */
export function fieldMatchEvaluator<TOutput extends Record<string, unknown>>(
  options: FieldMatchOptions<TOutput>
): Evaluator<TOutput, TOutput> {
  const { field, name = `field(${String(field)})`, compare = (a, b) => a === b } = options

  return {
    name,
    evaluate: (output: TOutput, expected: TOutput): EvaluatorResult => {
      const actualValue = output[field]
      const expectedValue = expected[field]
      const passed = compare(actualValue, expectedValue)

      return {
        name,
        score: passed ? 1 : 0,
        passed,
        details: passed
          ? undefined
          : `Expected ${String(field)}=${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`,
      }
    },
  }
}

/**
 * Options for multi-field classification.
 */
export interface MultiFieldMatchOptions<T> {
  /** Name for this evaluator */
  name?: string
  /** Fields to check in the output */
  fields: Array<keyof T>
  /** Whether all fields must match (default: true) */
  requireAll?: boolean
}

/**
 * Create a classification evaluator that checks multiple fields at once.
 *
 * @example
 * multiFieldMatchEvaluator<ClassificationResult>({
 *   fields: ["isKnowledgeWorthy", "knowledgeType"],
 *   name: "full-classification",
 * })
 */
export function multiFieldMatchEvaluator<TOutput extends Record<string, unknown>>(
  options: MultiFieldMatchOptions<TOutput>
): Evaluator<TOutput, TOutput> {
  const { fields, name = `fields(${fields.map(String).join(",")})`, requireAll = true } = options

  return {
    name,
    evaluate: (output: TOutput, expected: TOutput): EvaluatorResult => {
      const results = fields.map((field) => ({
        field: String(field),
        actual: output[field],
        expected: expected[field],
        matched: output[field] === expected[field],
      }))

      const matchedCount = results.filter((r) => r.matched).length
      const passed = requireAll ? matchedCount === fields.length : matchedCount > 0
      const score = fields.length > 0 ? matchedCount / fields.length : 1

      const mismatches = results.filter((r) => !r.matched)
      const details =
        mismatches.length > 0
          ? mismatches
              .map((r) => `${r.field}: expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`)
              .join("; ")
          : undefined

      return {
        name,
        score,
        passed,
        details,
      }
    },
  }
}

/**
 * Create a binary classification evaluator (true/false outcomes).
 *
 * Convenience wrapper for boolean field matching with clearer semantics.
 *
 * @example
 * binaryClassificationEvaluator<ClassificationResult>("isKnowledgeWorthy")
 */
export function binaryClassificationEvaluator<TOutput extends Record<string, unknown>>(
  field: keyof TOutput,
  options: { name?: string } = {}
): Evaluator<TOutput, TOutput> {
  return fieldMatchEvaluator({
    field,
    name: options.name ?? `binary(${String(field)})`,
  })
}

/**
 * Create a categorical classification evaluator.
 *
 * Checks if the output classification matches the expected category.
 * Can optionally accept related categories (e.g., "decision" matching "context").
 *
 * @example
 * categoricalEvaluator<ClassificationResult>({
 *   field: "knowledgeType",
 *   // Decision and context are considered related
 *   relatedCategories: {
 *     decision: ["context"],
 *     context: ["decision"],
 *   },
 * })
 */
export function categoricalEvaluator<TOutput extends Record<string, unknown>>(options: {
  field: keyof TOutput
  name?: string
  relatedCategories?: Record<string, string[]>
}): Evaluator<TOutput, TOutput> {
  const { field, name = `category(${String(field)})`, relatedCategories = {} } = options

  return {
    name,
    evaluate: (output: TOutput, expected: TOutput): EvaluatorResult => {
      const actualValue = output[field] as string
      const expectedValue = expected[field] as string

      // Exact match
      if (actualValue === expectedValue) {
        return {
          name,
          score: 1,
          passed: true,
        }
      }

      // Check related categories
      const related = relatedCategories[expectedValue] ?? []
      if (related.includes(actualValue)) {
        return {
          name,
          score: 0.8,
          passed: true,
          details: `Related category: expected ${expectedValue}, got ${actualValue}`,
        }
      }

      return {
        name,
        score: 0,
        passed: false,
        details: `Expected ${String(field)}="${expectedValue}", got "${actualValue}"`,
      }
    },
  }
}
