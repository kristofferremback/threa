/**
 * Classification evaluator for structured output field checks.
 *
 * Verifies that specific fields in structured output match expected values.
 */

import type { Evaluator, EvalContext, EvaluatorResult } from "../types"

/**
 * Options for field matching.
 */
export interface FieldMatchOptions<TOutput, TExpected, K extends keyof TOutput & keyof TExpected> {
  /** Name for this evaluator */
  name?: string
  /** Field to check in both output and expected */
  field: K
  /** Custom comparison function (default: strict equality) */
  compare?: (actual: TOutput[K], expected: TExpected[K]) => boolean
}

/**
 * Create a classification evaluator that checks if a field matches the expected value.
 *
 * @example
 * // Check boolean classification
 * fieldMatchEvaluator<Output, Expected, "isKnowledgeWorthy">({
 *   field: "isKnowledgeWorthy",
 * })
 *
 * // Check enum classification
 * fieldMatchEvaluator<Output, Expected, "knowledgeType">({
 *   field: "knowledgeType",
 *   name: "knowledge-type-match",
 * })
 */
export function fieldMatchEvaluator<TOutput, TExpected, K extends keyof TOutput & keyof TExpected>(
  options: FieldMatchOptions<TOutput, TExpected, K>
): Evaluator<TOutput, TExpected> {
  const { field, name = `field(${String(field)})`, compare = (a, b) => a === b } = options

  return {
    name,
    evaluate: (output: TOutput, expected: TExpected): EvaluatorResult => {
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
 * Create a binary classification evaluator (true/false outcomes).
 *
 * Convenience wrapper for boolean field matching with clearer semantics.
 *
 * @example
 * binaryClassificationEvaluator<Output, Expected, "isKnowledgeWorthy">("isKnowledgeWorthy")
 */
export function binaryClassificationEvaluator<TOutput, TExpected, K extends keyof TOutput & keyof TExpected>(
  field: K,
  options: { name?: string } = {}
): Evaluator<TOutput, TExpected> {
  return fieldMatchEvaluator<TOutput, TExpected, K>({
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
 * categoricalEvaluator<Output, Expected, "knowledgeType">({
 *   field: "knowledgeType",
 *   // Decision and context are considered related
 *   relatedCategories: {
 *     decision: ["context"],
 *     context: ["decision"],
 *   },
 * })
 */
export function categoricalEvaluator<TOutput, TExpected, K extends keyof TOutput & keyof TExpected>(options: {
  field: K
  name?: string
  relatedCategories?: Record<string, string[]>
}): Evaluator<TOutput, TExpected> {
  const { field, name = `category(${String(field)})`, relatedCategories = {} } = options

  return {
    name,
    evaluate: (output: TOutput, expected: TExpected): EvaluatorResult => {
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
