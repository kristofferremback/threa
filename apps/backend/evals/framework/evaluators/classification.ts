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
