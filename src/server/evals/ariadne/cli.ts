#!/usr/bin/env bun
/**
 * CLI for running Ariadne agent evals.
 *
 * Usage:
 *   bun run eval:ariadne                             # Run with default model from config
 *   bun run eval:ariadne --model openai:gpt-4o-mini  # Run with specific model
 *   bun run eval:ariadne --model preset:quality      # Use a preset
 *   bun run eval:ariadne --verbose                   # Show detailed output
 *   bun run eval:ariadne --no-langfuse               # Disable Langfuse tracking
 *   bun run eval:ariadne --dataset                   # Show dataset statistics
 *   bun run eval:ariadne --config                    # Show current config
 *
 * Environment variables:
 *   EVAL_AGENT_MODEL=openrouter:anthropic/claude-3.5-haiku
 */

import { runAriadneEval } from "./runner"
import { buildAriadneDataset, getAriadneDatasetStats } from "./dataset"
import { getAvailableModels, getConfiguredModels } from "../llm-verifier"
import { getEvalConfig, printEvalConfig, resolveModel, MODEL_PRESETS } from "../config"

async function main() {
  const args = process.argv.slice(2)

  // Parse args
  const verbose = args.includes("--verbose") || args.includes("-v")
  const noLangfuse = args.includes("--no-langfuse")
  const showDataset = args.includes("--dataset")
  const showConfig = args.includes("--config")
  const help = args.includes("--help") || args.includes("-h")

  // Get model from args or config
  const modelIndex = args.indexOf("--model")
  const config = getEvalConfig()
  const rawModel = modelIndex !== -1 ? args[modelIndex + 1] : config.agentModel
  const model = resolveModel(rawModel)

  if (help) {
    printHelp()
    process.exit(0)
  }

  if (showConfig) {
    printEvalConfig()
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
  // Filter to only show Anthropic, OpenAI, and OpenRouter models (Ollama not supported for agent evals)
  const supportedModels = getAvailableModels().filter(
    (m) => m.startsWith("anthropic:") || m.startsWith("openai:") || m.startsWith("openrouter:"),
  )

  const configuredModels = getConfiguredModels().filter(
    (m) => m.startsWith("anthropic:") || m.startsWith("openai:") || m.startsWith("openrouter:"),
  )

  const config = getEvalConfig()

  // Filter presets to only cloud models (Ollama not supported)
  const cloudPresets = Object.entries(MODEL_PRESETS).filter(
    ([_, model]) => !model.startsWith("ollama:"),
  )

  console.log(`
🧵 Ariadne Agent Eval CLI

Usage:
  bun run eval:ariadne [options]

Options:
  --model <name>    Model to evaluate (default from config: ${config.agentModel})
                    Format: provider:model or preset:name
                    Note: Ollama models are NOT supported for agent evals
                    OpenRouter: Copy model ID from https://openrouter.ai/models
  --verbose, -v     Show detailed output for each case
  --no-langfuse     Disable Langfuse tracking
  --dataset         Show dataset statistics
  --config          Show current eval configuration
  --help, -h        Show this help

Presets (--model preset:NAME):
${cloudPresets.map(([name, model]) => `  ${name.padEnd(10)} ${model}`).join("\n")}

Supported Models:
${supportedModels.map((m) => `  - ${m}`).join("\n")}

Configured Models (with API keys):
${configuredModels.map((m) => `  - ${m}`).join("\n")}

Environment Variables:
  EVAL_AGENT_MODEL   Override default agent eval model

Examples:
  bun run eval:ariadne
  bun run eval:ariadne --model preset:quality --verbose
  bun run eval:ariadne --model anthropic:claude-haiku-4-5-20251001
  bun run eval:ariadne --model openrouter:ibm-granite/granite-4.0-h-micro
  EVAL_AGENT_MODEL=openai:gpt-4o-mini bun run eval:ariadne
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
  .map((c) => `  ${c.id.padEnd(25)} [${c.mode}] ${c.expectedTools.map((t) => t.tool).join(", ") || "(no tools)"}`)
  .join("\n")}
`)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
