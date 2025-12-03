#!/usr/bin/env bun
/**
 * CLI for running memo evolution evals.
 *
 * Usage:
 *   bun run eval:evolution                          # Run with default model from config
 *   bun run eval:evolution --model ollama:gemma3:1b # Run with specific model
 *   bun run eval:evolution --model preset:fast      # Use a preset (fast, local, cheap, quality, best)
 *   bun run eval:evolution --verbose                # Show detailed output
 *   bun run eval:evolution --no-langfuse            # Disable Langfuse tracking
 *   bun run eval:evolution --compare                # Compare multiple models
 *   bun run eval:evolution --config                 # Show current config
 *
 * Environment variables:
 *   EVAL_MODEL=openrouter:ibm-granite/granite-4.0-h-micro
 */

import { runEval } from "./runner"
import { getAvailableModels, getConfiguredModels } from "./llm-verifier"
import { buildDatasetFromFixtures, getDatasetStats } from "./dataset"
import { getEvalConfig, printEvalConfig, resolveModel, MODEL_PRESETS } from "./config"

async function main() {
  const args = process.argv.slice(2)

  // Parse args
  const verbose = args.includes("--verbose") || args.includes("-v")
  const noLangfuse = args.includes("--no-langfuse")
  const compare = args.includes("--compare")
  const showDataset = args.includes("--dataset")
  const showConfig = args.includes("--config")
  const help = args.includes("--help") || args.includes("-h")

  // Get model from args or config
  const modelIndex = args.indexOf("--model")
  const config = getEvalConfig()
  const rawModel = modelIndex !== -1 ? args[modelIndex + 1] : config.evalModel
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

  if (compare) {
    await runComparison(verbose, !noLangfuse)
    process.exit(0)
  }

  // Run single model eval
  await runEval({
    model,
    langfuseEnabled: !noLangfuse,
    verbose,
  })
}

function printHelp() {
  const config = getEvalConfig()

  console.log(`
📊 Memo Evolution Eval CLI

Usage:
  bun run eval:evolution [options]

Options:
  --model <name>    Model to evaluate (default from config: ${config.evalModel})
                    Format: provider:model or preset:name
  --verbose, -v     Show detailed output for each case
  --no-langfuse     Disable Langfuse tracking
  --compare         Run eval on all configured models
  --dataset         Show dataset statistics
  --config          Show current eval configuration
  --help, -h        Show this help

Presets (--model preset:NAME):
${Object.entries(MODEL_PRESETS)
  .map(([name, model]) => `  ${name.padEnd(10)} ${model}`)
  .join("\n")}

Available Models:
${getAvailableModels()
  .map((m) => `  - ${m}`)
  .join("\n")}

Configured Models (with API keys):
${getConfiguredModels()
  .map((m) => `  - ${m}`)
  .join("\n")}

OpenRouter:
  Use any model from https://openrouter.ai/models
  Copy the model ID and prefix with "openrouter:"
  Example: openrouter:ibm-granite/granite-4.0-h-micro

Environment Variables:
  EVAL_MODEL           Override default eval model
  EVAL_JUDGE_MODEL     Override judge model (for cross-family evaluation)
  EVAL_EMBEDDING_MODEL Override embedding model

Examples:
  bun run eval:evolution
  bun run eval:evolution --model preset:fast --verbose
  bun run eval:evolution --model ollama:granite4:1b
  bun run eval:evolution --model openrouter:ibm-granite/granite-4.0-h-micro
  EVAL_MODEL=preset:quality bun run eval:evolution
`)
}

function printDataset() {
  const dataset = buildDatasetFromFixtures()
  const stats = getDatasetStats(dataset)

  console.log(`
📊 Eval Dataset: ${dataset.name} v${dataset.version}

Total Cases: ${stats.total}

By Scenario:
${Object.entries(stats.byScenario)
  .map(([scenario, count]) => `  ${scenario}: ${count}`)
  .join("\n")}

By Expected Action:
${Object.entries(stats.byAction)
  .map(([action, count]) => `  ${action}: ${count}`)
  .join("\n")}

By Expected Same Topic:
  yes: ${stats.bySameTopic.yes}
  no: ${stats.bySameTopic.no}
`)
}

async function runComparison(verbose: boolean, langfuseEnabled: boolean) {
  const models = getConfiguredModels()
  const results: Array<{ model: string; accuracy: number; precision: number; recall: number; avgLatencyMs: number }> =
    []

  console.log(`\n🔄 Comparing ${models.length} models...\n`)

  for (const model of models) {
    console.log(`\n━━━ Model: ${model} ━━━`)

    try {
      const summary = await runEval({
        model,
        langfuseEnabled,
        verbose,
      })

      results.push({
        model,
        accuracy: summary.sameTopicAccuracy,
        precision: summary.sameTopicPrecision,
        recall: summary.sameTopicRecall,
        avgLatencyMs: summary.avgLlmLatencyMs,
      })
    } catch (err) {
      console.error(`❌ Failed to run eval for ${model}:`, err)
    }
  }

  // Print comparison table
  console.log(`\n\n📊 Model Comparison`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`${"Model".padEnd(25)} ${"Accuracy".padStart(10)} ${"Precision".padStart(10)} ${"Recall".padStart(10)} ${"Latency".padStart(10)}`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)

  for (const r of results.sort((a, b) => b.accuracy - a.accuracy)) {
    console.log(
      `${r.model.padEnd(25)} ${(r.accuracy * 100).toFixed(1).padStart(9)}% ${(r.precision * 100).toFixed(1).padStart(9)}% ${(r.recall * 100).toFixed(1).padStart(9)}% ${r.avgLatencyMs.toFixed(0).padStart(8)}ms`,
    )
  }

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
