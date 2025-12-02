#!/usr/bin/env bun
/**
 * CLI for running Ariadne agent evals.
 *
 * Usage:
 *   bun run eval:ariadne                             # Run with default model (claude-3-5-haiku-latest)
 *   bun run eval:ariadne --model openai:gpt-4o-mini  # Run with specific model
 *   bun run eval:ariadne --verbose                   # Show detailed output
 *   bun run eval:ariadne --no-langfuse               # Disable Langfuse tracking
 *   bun run eval:ariadne --dataset                   # Show dataset statistics
 */

import { runAriadneEval } from "./runner"
import { buildAriadneDataset, getAriadneDatasetStats } from "./dataset"
import { getAvailableModels, getConfiguredModels } from "../llm-verifier"

async function main() {
  const args = process.argv.slice(2)

  // Parse args
  const verbose = args.includes("--verbose") || args.includes("-v")
  const noLangfuse = args.includes("--no-langfuse")
  const showDataset = args.includes("--dataset")
  const help = args.includes("--help") || args.includes("-h")

  const modelIndex = args.indexOf("--model")
  const model = modelIndex !== -1 ? args[modelIndex + 1] : "anthropic:claude-haiku-4-5-20251001"

  if (help) {
    printHelp()
    process.exit(0)
  }

  if (showDataset) {
    printDataset()
    process.exit(0)
  }

  // Run eval
  await runAriadneEval({
    model,
    langfuseEnabled: !noLangfuse,
    verbose,
  })
}

function printHelp() {
  // Filter to only show Anthropic and OpenAI models (Ollama not supported for agent evals)
  const supportedModels = getAvailableModels().filter(
    (m) => m.startsWith("anthropic:") || m.startsWith("openai:"),
  )

  const configuredModels = getConfiguredModels().filter(
    (m) => m.startsWith("anthropic:") || m.startsWith("openai:"),
  )

  console.log(`
🧵 Ariadne Agent Eval CLI

Usage:
  bun run eval:ariadne [options]

Options:
  --model <name>    Model to evaluate (default: anthropic:claude-haiku-4-5-20251001)
                    Format: provider:model (e.g., anthropic:claude-haiku-4-5-20251001, openai:gpt-4o-mini)
                    Note: Ollama models are NOT supported for agent evals
  --verbose, -v     Show detailed output for each case
  --no-langfuse     Disable Langfuse tracking
  --dataset         Show dataset statistics
  --help, -h        Show this help

Supported Models:
${supportedModels.map((m) => `  - ${m}`).join("\n")}

Configured Models (with API keys):
${configuredModels.map((m) => `  - ${m}`).join("\n")}

Examples:
  bun run eval:ariadne
  bun run eval:ariadne --model anthropic:claude-haiku-4-5-20251001 --verbose
  bun run eval:ariadne --model openai:gpt-4o-mini
  bun run eval:ariadne --no-langfuse
`)
}

function printDataset() {
  const dataset = buildAriadneDataset()
  const stats = getAriadneDatasetStats(dataset)

  console.log(`
🧵 Ariadne Eval Dataset: ${dataset.name} v${dataset.version}

Total Cases: ${stats.total}
Avg Expected Tools: ${stats.avgExpectedTools.toFixed(1)}

By Scenario:
${Object.entries(stats.byScenario)
  .map(([scenario, count]) => `  ${scenario.padEnd(20)} ${count}`)
  .join("\n")}

By Mode:
${Object.entries(stats.byMode)
  .map(([mode, count]) => `  ${mode.padEnd(20)} ${count}`)
  .join("\n")}

Cases:
${dataset.cases
  .map(
    (c) =>
      `  ${c.id.padEnd(25)} [${c.mode}] ${c.expectedTools.map((t) => t.tool).join(", ") || "(no tools)"}`,
  )
  .join("\n")}
`)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
