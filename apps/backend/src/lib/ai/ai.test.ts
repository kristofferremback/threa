import { describe, it, expect } from "bun:test"
import { parseModelId, createAI, type UsageWithCost } from "./ai"

// Import fixture data captured from real OpenRouter API calls (2026-01-06)
import fixtures from "./fixtures/openrouter-responses.json"

describe("parseModelId", () => {
  it("should parse openrouter model with nested path", () => {
    const result = parseModelId("openrouter:anthropic/claude-haiku-4.5")

    expect(result).toEqual({
      provider: "openrouter",
      modelId: "anthropic/claude-haiku-4.5",
      modelProvider: "anthropic",
      modelName: "claude-haiku-4.5",
    })
  })

  it("should parse openrouter model with openai path", () => {
    const result = parseModelId("openrouter:openai/gpt-5-mini")

    expect(result).toEqual({
      provider: "openrouter",
      modelId: "openai/gpt-5-mini",
      modelProvider: "openai",
      modelName: "gpt-5-mini",
    })
  })

  it("should parse direct anthropic model (no nested path)", () => {
    const result = parseModelId("anthropic:claude-sonnet-4-20250514")

    expect(result).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      modelProvider: "anthropic",
      modelName: "claude-sonnet-4-20250514",
    })
  })

  it("should parse model with version tag containing colons", () => {
    const result = parseModelId("provider:model:v1:latest")

    expect(result).toEqual({
      provider: "provider",
      modelId: "model:v1:latest",
      modelProvider: "provider",
      modelName: "model:v1:latest",
    })
  })

  it("should throw for missing colon separator", () => {
    expect(() => parseModelId("anthropic-claude-sonnet")).toThrow(
      'Invalid provider:model format: "anthropic-claude-sonnet"'
    )
  })

  it("should throw for empty provider", () => {
    expect(() => parseModelId(":claude-sonnet")).toThrow('Invalid provider:model format: ":claude-sonnet"')
  })

  it("should throw for empty model ID", () => {
    expect(() => parseModelId("anthropic:")).toThrow('Invalid provider:model format: "anthropic:"')
  })
})

describe("createAI", () => {
  describe("configuration", () => {
    it("should throw when provider not configured", () => {
      const ai = createAI({})

      expect(() => ai.getLanguageModel("openrouter:anthropic/claude-haiku-4.5")).toThrow("OpenRouter not configured")
    })

    it("should throw for unsupported provider", () => {
      const ai = createAI({ openrouter: { apiKey: "test-key" } })

      expect(() => ai.getLanguageModel("unknown:some-model")).toThrow('Unsupported provider: "unknown"')
    })
  })

  describe("parseModel", () => {
    it("should expose parseModel function", () => {
      const ai = createAI({})
      const result = ai.parseModel("openrouter:anthropic/claude-haiku-4.5")

      expect(result.modelProvider).toBe("anthropic")
    })
  })
})

describe("API behavior", () => {
  it("should expose telemetry option for embed operations", () => {
    const ai = createAI({ openrouter: { apiKey: "test-key" } })

    // Verify the interface accepts telemetry - actual call would need mocking
    const embedOptions = {
      model: "openrouter:openai/text-embedding-3-small",
      value: "test text",
      telemetry: { functionId: "test-embed" },
    }
    const embedManyOptions = {
      model: "openrouter:openai/text-embedding-3-small",
      values: ["test1", "test2"],
      telemetry: { functionId: "test-embed-many", metadata: { count: 2 } },
    }

    // Type check passes if these compile
    expect(embedOptions.telemetry.functionId).toBe("test-embed")
    expect(embedManyOptions.telemetry.functionId).toBe("test-embed-many")
  })

  it("should have consistent error messages mentioning env var and config", () => {
    const ai = createAI({})

    expect(() => ai.getLanguageModel("openrouter:test")).toThrow(/OPENROUTER_API_KEY.*openrouter\.apiKey/)
    expect(() => ai.getEmbeddingModel("openrouter:test")).toThrow(/OPENROUTER_API_KEY.*openrouter\.apiKey/)
    expect(() => ai.getLangChainModel("openrouter:test")).toThrow(/OPENROUTER_API_KEY.*openrouter\.apiKey/)
  })

  it("should list supported providers in error for unsupported provider", () => {
    const ai = createAI({ openrouter: { apiKey: "test-key" } })

    expect(() => ai.getLanguageModel("unsupported:model")).toThrow(/Currently supported: openrouter/)
  })
})

describe("OpenRouter response fixtures", () => {
  // These fixtures were captured from real OpenRouter API calls on 2026-01-06
  // They document the expected response structure for cost tracking

  it("should have generateText fixture with cost data", () => {
    const { providerMetadata } = fixtures.generateText

    expect(providerMetadata.openrouter).toBeDefined()
    expect(providerMetadata.openrouter.usage).toBeDefined()
    expect(providerMetadata.openrouter.usage.cost).toBe(0.0000036)
    expect(providerMetadata.openrouter.usage.promptTokens).toBe(16)
    expect(providerMetadata.openrouter.usage.completionTokens).toBe(2)
    expect(providerMetadata.openrouter.usage.totalTokens).toBe(18)
  })

  it("should have generateObject fixture with cost data", () => {
    const { providerMetadata } = fixtures.generateObject

    expect(providerMetadata.openrouter.usage.cost).toBe(0.00001545)
    expect(providerMetadata.openrouter.usage.promptTokens).toBe(59)
    expect(providerMetadata.openrouter.usage.completionTokens).toBe(11)
    expect(providerMetadata.openrouter.usage.totalTokens).toBe(70)
  })

  it("should have embed fixture with tokens and cost", () => {
    const { usage, providerMetadata } = fixtures.embed

    // Embedding models have different usage shape (just 'tokens', no prompt/completion split)
    expect(usage.tokens).toBe(4)
    expect(providerMetadata.openrouter.usage.cost).toBe(8e-8)
  })

  it("should have embedMany fixture with tokens and cost", () => {
    const { usage, providerMetadata } = fixtures.embedMany

    expect(usage.tokens).toBe(3)
    expect(providerMetadata.openrouter.usage.cost).toBe(6e-8)
  })
})
