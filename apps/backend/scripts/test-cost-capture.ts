/**
 * Test script to verify OpenRouter cost capture is working.
 * Run with: bun scripts/test-cost-capture.ts
 *
 * This makes real API calls to OpenRouter and logs the cost data.
 */

import { createAI } from "../src/lib/ai/ai"
import { z } from "zod"

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY

if (!OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY is not set")
  process.exit(1)
}

const ai = createAI({
  openrouter: { apiKey: OPENROUTER_API_KEY },
})

async function testGenerateText() {
  console.log("\n=== Testing generateText ===")

  const result = await ai.generateText({
    model: "openrouter:openai/gpt-4o-mini",
    messages: [{ role: "user", content: "Say 'hello world' and nothing else." }],
    maxTokens: 10,
    telemetry: { functionId: "test-generate-text" },
  })

  console.log("Response:", result.value)
  console.log("Usage from wrapper:", JSON.stringify(result.usage, null, 2))

  return result.usage
}

async function testGenerateObject() {
  console.log("\n=== Testing generateObject ===")

  const schema = z.object({
    greeting: z.string(),
    language: z.string(),
  })

  const result = await ai.generateObject({
    model: "openrouter:openai/gpt-4o-mini",
    schema,
    messages: [
      {
        role: "user",
        content: "Return a greeting object with 'greeting' and 'language' fields for English",
      },
    ],
    maxTokens: 50,
    telemetry: { functionId: "test-generate-object" },
  })

  console.log("Response:", result.value)
  console.log("Usage:", JSON.stringify(result.usage, null, 2))

  return result.usage
}

async function testEmbed() {
  console.log("\n=== Testing embed ===")

  const result = await ai.embed({
    model: "openrouter:openai/text-embedding-3-small",
    value: "Hello, world!",
    telemetry: { functionId: "test-embed" },
  })

  console.log("Embedding length:", result.value.length)
  console.log("Usage:", JSON.stringify(result.usage, null, 2))

  // Capture raw provider metadata for fixture
  // @ts-expect-error - Response object has providerMetadata at runtime
  const embedMetadata = result.response.providerMetadata ?? result.response.experimental_providerMetadata
  console.log("Raw providerMetadata:", JSON.stringify(embedMetadata, null, 2))

  return result.usage
}

async function testEmbedMany() {
  console.log("\n=== Testing embedMany ===")

  const result = await ai.embedMany({
    model: "openrouter:openai/text-embedding-3-small",
    values: ["Hello", "World", "Test"],
    telemetry: { functionId: "test-embed-many" },
  })

  console.log("Embeddings count:", result.value.length)
  console.log("Usage:", JSON.stringify(result.usage, null, 2))

  // Capture raw provider metadata for fixture
  // @ts-expect-error - Response object has providerMetadata at runtime
  const embedManyMetadata = result.response.providerMetadata ?? result.response.experimental_providerMetadata
  console.log("Raw providerMetadata:", JSON.stringify(embedManyMetadata, null, 2))

  return result.usage
}

async function testLangChainMinimaxM2() {
  console.log("\n=== Testing LangChain with minimax/minimax-m2.1 ===")

  const model = await ai.getLangChainModel("openrouter:minimax/minimax-m2.1")

  // Run within cost tracking context
  const usage = await ai.costTracker.runWithTracking(async () => {
    const result = await model.invoke([{ role: "user", content: "Say 'hello' and nothing else." }])

    console.log("Response:", result.content)

    const captured = ai.costTracker.getCapturedUsage()
    console.log("Captured usage:", JSON.stringify(captured, null, 2))

    return captured
  })

  return usage
}

async function testLangChainGpt4oMini() {
  console.log("\n=== Testing LangChain with openai/gpt-4o-mini ===")

  const model = await ai.getLangChainModel("openrouter:openai/gpt-4o-mini")

  // Run within cost tracking context
  const usage = await ai.costTracker.runWithTracking(async () => {
    const result = await model.invoke([{ role: "user", content: "Say 'hello' and nothing else." }])

    console.log("Response:", result.content)

    const captured = ai.costTracker.getCapturedUsage()
    console.log("Captured usage:", JSON.stringify(captured, null, 2))

    return captured
  })

  return usage
}

async function main() {
  console.log("Testing OpenRouter cost capture...")
  console.log("API Key present:", !!OPENROUTER_API_KEY)

  const results = {
    generateText: await testGenerateText(),
    generateObject: await testGenerateObject(),
    embed: await testEmbed(),
    embedMany: await testEmbedMany(),
    langchainGpt4oMini: await testLangChainGpt4oMini(),
    langchainMinimaxM2: await testLangChainMinimaxM2(),
  }

  console.log("\n=== Summary ===")
  console.log(JSON.stringify(results, null, 2))

  // Verify costs are present
  const hasCosts = Object.values(results).every((u) => typeof u.cost === "number")
  if (hasCosts) {
    console.log("\n✅ All operations returned cost data!")
    const totalCost = Object.values(results).reduce((sum, u) => sum + (u.cost ?? 0), 0)
    console.log(`Total cost: $${totalCost.toFixed(6)}`)
  } else {
    console.log("\n⚠️ Some operations did not return cost data")
    console.log("This may indicate the usage: { include: true } option is not being respected")
  }
}

main().catch(console.error)
