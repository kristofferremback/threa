/**
 * Contains evaluator for string matching.
 *
 * Checks if output contains expected strings with optional transforms.
 * Supports date resolution for relative dates like "tomorrow", "next week".
 */

import type { Evaluator, EvalContext } from "../types"
import { formatDate } from "../../../src/lib/temporal"

/**
 * Date transform that resolves relative dates to actual dates.
 * Maps common relative references to their actual dates.
 */
function resolveDateTransform(text: string, timezone: string): string {
  const now = new Date()
  let result = text

  // Map of relative date patterns to functions that compute the actual date
  const relativeDates: Array<{
    pattern: RegExp
    resolve: () => Date
  }> = [
    {
      pattern: /\btoday\b/gi,
      resolve: () => now,
    },
    {
      pattern: /\btomorrow\b/gi,
      resolve: () => {
        const date = new Date(now)
        date.setDate(date.getDate() + 1)
        return date
      },
    },
    {
      pattern: /\byesterday\b/gi,
      resolve: () => {
        const date = new Date(now)
        date.setDate(date.getDate() - 1)
        return date
      },
    },
    {
      pattern: /\bnext week\b/gi,
      resolve: () => {
        const date = new Date(now)
        date.setDate(date.getDate() + 7)
        return date
      },
    },
    {
      pattern: /\blast week\b/gi,
      resolve: () => {
        const date = new Date(now)
        date.setDate(date.getDate() - 7)
        return date
      },
    },
    {
      pattern: /\bnext month\b/gi,
      resolve: () => {
        const date = new Date(now)
        date.setMonth(date.getMonth() + 1)
        return date
      },
    },
    {
      pattern: /\blast month\b/gi,
      resolve: () => {
        const date = new Date(now)
        date.setMonth(date.getMonth() - 1)
        return date
      },
    },
  ]

  // Replace relative dates with formatted dates
  for (const { pattern, resolve } of relativeDates) {
    result = result.replace(pattern, formatDate(resolve(), timezone, "YYYY-MM-DD"))
  }

  return result
}

/**
 * Options for the contains evaluator.
 */
export interface ContainsEvaluatorOptions {
  /** Name for this evaluator (default: "contains") */
  name?: string
  /** Case insensitive matching (default: true) */
  caseInsensitive?: boolean
  /** Transform to apply to expected values before matching */
  transform?: "date-resolve" | ((text: string, ctx: EvalContext) => string)
  /** Timezone for date resolution (default: UTC) */
  timezone?: string
  /** Whether all expected strings must be present (default: true) */
  requireAll?: boolean
}

/**
 * Create a contains evaluator that checks if output contains expected strings.
 *
 * @example
 * // Simple string contains
 * containsEvaluator()
 *
 * // With date resolution
 * containsEvaluator({
 *   transform: "date-resolve",
 *   timezone: "America/New_York"
 * })
 */
export function containsEvaluator(options: ContainsEvaluatorOptions = {}): Evaluator<string, string | string[]> {
  const { name = "contains", caseInsensitive = true, transform, timezone = "UTC", requireAll = true } = options

  return {
    name,
    evaluate: (output: string, expected: string | string[], ctx: EvalContext) => {
      const expectedArray = Array.isArray(expected) ? expected : [expected]
      const outputText = caseInsensitive ? output.toLowerCase() : output

      const results: Array<{ expected: string; found: boolean }> = []

      for (let exp of expectedArray) {
        // Apply transform if specified
        if (transform === "date-resolve") {
          exp = resolveDateTransform(exp, timezone)
        } else if (typeof transform === "function") {
          exp = transform(exp, ctx)
        }

        const searchText = caseInsensitive ? exp.toLowerCase() : exp
        const found = outputText.includes(searchText)
        results.push({ expected: exp, found })
      }

      const passedCount = results.filter((r) => r.found).length
      const totalCount = results.length
      const passed = requireAll ? passedCount === totalCount : passedCount > 0

      // Score is proportion of expected strings found
      const score = totalCount > 0 ? passedCount / totalCount : 1

      // Build details string
      const missingItems = results.filter((r) => !r.found).map((r) => r.expected)
      const details = missingItems.length > 0 ? `Missing: ${missingItems.map((s) => `"${s}"`).join(", ")}` : undefined

      return {
        name,
        score,
        passed,
        details,
      }
    },
  }
}
