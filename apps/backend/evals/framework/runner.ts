/**
 * Main evaluation runner.
 *
 * Orchestrates the evaluation process:
 * 1. Set up isolated database
 * 2. Create fixtures (workspace, users)
 * 3. Run each permutation
 * 4. Execute evaluators
 * 5. Record to Langfuse
 * 6. Clean up
 */

import type { Langfuse } from "langfuse"
import type {
  EvalSuite,
  EvalContext,
  EvalPermutation,
  CaseResult,
  PermutationResult,
  SuiteResult,
  RunnerOptions,
} from "./types"
import { setupEvalDatabase, type EvalDatabaseResult } from "./database"
import { recordEvalRun, createLangfuseClient } from "./langfuse"
import { createAI, type AI } from "../../src/lib/ai/ai"
import { createWorkspaceFixture, type WorkspaceFixture } from "../fixtures/workspace"

/**
 * Console output colors for terminal.
 */
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
}

/**
 * Format duration in human-readable form.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

/**
 * Create AI wrapper with eval configuration.
 */
function createEvalAI(): AI {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is required for evals")
  }

  return createAI({
    openrouter: { apiKey },
  })
}

/**
 * Run a single evaluation case.
 */
async function runCase<TInput, TOutput, TExpected>(
  suite: EvalSuite<TInput, TOutput, TExpected>,
  caseItem: (typeof suite.cases)[number],
  ctx: EvalContext,
  options: RunnerOptions
): Promise<CaseResult<TOutput, TExpected>> {
  const startTime = Date.now()

  try {
    // Run case setup if provided
    if (caseItem.setup) {
      await caseItem.setup(ctx)
    }

    // Execute the task
    const output = await suite.task(caseItem.input, ctx)

    // Run evaluators
    const evaluations = await Promise.all(
      suite.evaluators.map(async (evaluator) => {
        try {
          return await evaluator.evaluate(output, caseItem.expectedOutput, ctx)
        } catch (error) {
          return {
            name: evaluator.name,
            score: 0,
            passed: false,
            details: `Evaluator error: ${error instanceof Error ? error.message : String(error)}`,
          }
        }
      })
    )

    // Run case teardown if provided
    if (caseItem.teardown) {
      await caseItem.teardown(ctx)
    }

    const durationMs = Date.now() - startTime

    return {
      caseId: caseItem.id,
      caseName: caseItem.name,
      input: caseItem.input,
      output,
      expectedOutput: caseItem.expectedOutput,
      evaluations,
      durationMs,
    }
  } catch (error) {
    const durationMs = Date.now() - startTime

    // Run teardown even on error
    if (caseItem.teardown) {
      try {
        await caseItem.teardown(ctx)
      } catch {
        // Ignore teardown errors
      }
    }

    return {
      caseId: caseItem.id,
      caseName: caseItem.name,
      input: caseItem.input,
      output: undefined as TOutput,
      expectedOutput: caseItem.expectedOutput,
      evaluations: [],
      durationMs,
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}

/**
 * Run all cases for a single permutation.
 */
async function runPermutation<TInput, TOutput, TExpected>(
  suite: EvalSuite<TInput, TOutput, TExpected>,
  permutation: EvalPermutation,
  dbResult: EvalDatabaseResult,
  ai: AI,
  fixture: WorkspaceFixture,
  options: RunnerOptions
): Promise<PermutationResult<TOutput, TExpected>> {
  const startTime = Date.now()
  const cases: CaseResult<TOutput, TExpected>[] = []

  // Filter cases if specified
  const casesToRun = options.cases ? suite.cases.filter((c) => options.cases!.includes(c.id)) : suite.cases

  // Create context for this permutation
  const ctx: EvalContext = {
    pool: dbResult.pool,
    ai,
    workspaceId: fixture.workspaceId,
    userId: fixture.userId,
    permutation,
  }

  // Run suite setup if provided
  if (suite.setup) {
    await suite.setup(ctx)
  }

  // Run each case sequentially
  const totalCases = casesToRun.length
  for (let i = 0; i < casesToRun.length; i++) {
    const caseItem = casesToRun[i]
    const caseNum = i + 1

    // Always show progress
    process.stdout.write(`  ${colors.dim}[${caseNum}/${totalCases}]${colors.reset} ${caseItem.name}... `)

    const result = await runCase(suite, caseItem, ctx, options)
    cases.push(result)

    // Show result status
    const passed = !result.error && result.evaluations.every((e) => e.passed)
    const status = result.error
      ? `${colors.red}ERROR${colors.reset}`
      : passed
        ? `${colors.green}PASS${colors.reset}`
        : `${colors.red}FAIL${colors.reset}`
    console.log(`${status} ${colors.dim}(${formatDuration(result.durationMs)})${colors.reset}`)
  }

  // Run suite teardown if provided
  if (suite.teardown) {
    await suite.teardown(ctx)
  }

  // Run run-level evaluators
  const runEvaluations = suite.runEvaluators ? await Promise.all(suite.runEvaluators.map((e) => e.evaluate(cases))) : []

  return {
    permutation,
    cases,
    runEvaluations,
    totalDurationMs: Date.now() - startTime,
  }
}

/**
 * Print summary of evaluation results.
 */
function printSummary<TOutput, TExpected>(result: SuiteResult<TOutput, TExpected>): void {
  console.log("\n" + "=".repeat(60))
  console.log(`${colors.cyan}Suite: ${result.suiteName}${colors.reset}`)
  console.log("=".repeat(60))

  for (const permResult of result.permutations) {
    const { permutation, cases, totalDurationMs } = permResult
    const passedCases = cases.filter((c) => !c.error && c.evaluations.every((e) => e.passed))
    const failedCases = cases.filter((c) => c.error || c.evaluations.some((e) => !e.passed))

    console.log(`\nPermutation: ${permutation.model}`)
    if (permutation.temperature !== undefined) {
      console.log(`  Temperature: ${permutation.temperature}`)
    }
    if (permutation.promptVariant) {
      console.log(`  Prompt Variant: ${permutation.promptVariant}`)
    }

    console.log(
      `\n  ${colors.green}Passed: ${passedCases.length}${colors.reset}  ${colors.red}Failed: ${failedCases.length}${colors.reset}  ${colors.dim}Duration: ${formatDuration(totalDurationMs)}${colors.reset}`
    )

    // Show all cases
    console.log("\n  Cases:")
    for (const caseResult of cases) {
      const passed = !caseResult.error && caseResult.evaluations.every((e) => e.passed)

      if (passed) {
        // Passed case - compact output
        console.log(`    ${colors.green}✓${colors.reset} ${caseResult.caseName}`)
      } else {
        // Failed case - detailed output
        console.log(`    ${colors.red}✗${colors.reset} ${caseResult.caseName}`)
        if (caseResult.error) {
          console.log(`      ${colors.red}Error: ${caseResult.error.message}${colors.reset}`)
        }
        for (const evaluation of caseResult.evaluations.filter((e) => !e.passed)) {
          console.log(`      ${colors.yellow}${evaluation.name}: ${evaluation.score}${colors.reset}`)
          if (evaluation.details) {
            console.log(`        ${colors.dim}${evaluation.details}${colors.reset}`)
          }
        }
      }
    }

    // Show run-level evaluations
    if (permResult.runEvaluations.length > 0) {
      console.log("\n  Run Evaluations:")
      for (const evaluation of permResult.runEvaluations) {
        const status = evaluation.passed ? colors.green : colors.red
        console.log(`    ${status}${evaluation.name}: ${evaluation.score}${colors.reset}`)
      }
    }
  }

  // Show Langfuse trace ID if available
  if (result.langfuseTraceId) {
    console.log(`\n${colors.cyan}Langfuse Trace: ${result.langfuseTraceId}${colors.reset}`)
  }

  console.log("\n" + "=".repeat(60))
}

/**
 * Run a single evaluation suite.
 */
export async function runSuite<TInput, TOutput, TExpected>(
  suite: EvalSuite<TInput, TOutput, TExpected>,
  options: RunnerOptions = {}
): Promise<SuiteResult<TOutput, TExpected>> {
  console.log(`\n${colors.cyan}Running suite: ${suite.name}${colors.reset}`)
  if (suite.description) {
    console.log(`${colors.dim}${suite.description}${colors.reset}`)
  }

  // Set up database
  const dbResult = await setupEvalDatabase({ label: suite.name })

  // Create AI wrapper
  const ai = createEvalAI()

  // Create Langfuse client if enabled
  const langfuseClient = options.noLangfuse ? null : createLangfuseClient()

  // Create initial fixture
  const fixture = await createWorkspaceFixture(dbResult.pool)

  // Determine permutations to run
  let permutations = suite.defaultPermutations
  if (options.model) {
    // Override with CLI model
    permutations = [
      {
        model: options.model,
        temperature: options.temperature,
      },
    ]
  }

  const permutationResults: PermutationResult<TOutput, TExpected>[] = []
  let lastTraceId: string | undefined

  try {
    // Run each permutation
    for (const permutation of permutations) {
      console.log(`\n${colors.yellow}Permutation: ${permutation.model}${colors.reset}`)

      const permResult = await runPermutation(suite, permutation, dbResult, ai, fixture, options)
      permutationResults.push(permResult)

      // Record to Langfuse if enabled
      if (langfuseClient) {
        lastTraceId = await recordEvalRun({
          client: langfuseClient,
          suiteName: suite.name,
          permutation,
          cases: permResult.cases,
          runEvaluations: permResult.runEvaluations,
        })
      }
    }
  } finally {
    // Clean up
    await dbResult.cleanup()
    if (langfuseClient) {
      await langfuseClient.shutdownAsync()
    }
  }

  const result: SuiteResult<TOutput, TExpected> = {
    suiteName: suite.name,
    permutations: permutationResults,
    langfuseTraceId: lastTraceId,
  }

  // Print summary
  printSummary(result)

  return result
}

/**
 * Run multiple evaluation suites.
 */
export async function runSuites(
  suites: EvalSuite<unknown, unknown, unknown>[],
  options: RunnerOptions = {}
): Promise<SuiteResult<unknown, unknown>[]> {
  // Filter suites if specified
  const suitesToRun = options.suite ? suites.filter((s) => s.name === options.suite) : suites

  if (suitesToRun.length === 0) {
    if (options.suite) {
      console.log(`${colors.red}No suite found with name: ${options.suite}${colors.reset}`)
      console.log(`Available suites: ${suites.map((s) => s.name).join(", ")}`)
    } else {
      console.log(`${colors.yellow}No suites to run${colors.reset}`)
    }
    return []
  }

  const results: SuiteResult<unknown, unknown>[] = []

  for (const suite of suitesToRun) {
    const result = await runSuite(suite, options)
    results.push(result)
  }

  // Print overall summary
  console.log("\n" + "=".repeat(60))
  console.log(`${colors.cyan}Overall Summary${colors.reset}`)
  console.log("=".repeat(60))

  let totalPassed = 0
  let totalFailed = 0

  for (const result of results) {
    for (const permResult of result.permutations) {
      for (const caseResult of permResult.cases) {
        if (!caseResult.error && caseResult.evaluations.every((e) => e.passed)) {
          totalPassed++
        } else {
          totalFailed++
        }
      }
    }
  }

  console.log(
    `\n${colors.green}Total Passed: ${totalPassed}${colors.reset}  ${colors.red}Total Failed: ${totalFailed}${colors.reset}`
  )

  return results
}
