import { describe, expect, it } from "bun:test"
import { ProviderRegistry } from "./provider-registry"

describe("ProviderRegistry", () => {
  // Create a registry without API keys for parsing tests
  const registry = new ProviderRegistry({})

  describe("parseProviderModel", () => {
    it("should parse openrouter:model format", () => {
      const result = registry.parseProviderModel("openrouter:anthropic/claude-3-haiku")
      expect(result).toEqual({
        provider: "openrouter",
        modelId: "anthropic/claude-3-haiku",
      })
    })

    it("should parse anthropic:model format", () => {
      const result = registry.parseProviderModel("anthropic:claude-sonnet-4-20250514")
      expect(result).toEqual({
        provider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
      })
    })

    it("should handle model IDs with colons (ollama)", () => {
      const result = registry.parseProviderModel("ollama:granite4:350m")
      expect(result).toEqual({
        provider: "ollama",
        modelId: "granite4:350m",
      })
    })

    it("should throw for missing colon", () => {
      expect(() => registry.parseProviderModel("invalid")).toThrow(
        'Invalid provider:model format: "invalid"',
      )
    })

    it("should throw for empty provider", () => {
      expect(() => registry.parseProviderModel(":model")).toThrow(
        'Invalid provider:model format: ":model"',
      )
    })

    it("should throw for empty model", () => {
      expect(() => registry.parseProviderModel("provider:")).toThrow(
        'Invalid provider:model format: "provider:"',
      )
    })
  })

  describe("isSupportedProvider", () => {
    it("should return true for openrouter", () => {
      expect(registry.isSupportedProvider("openrouter")).toBe(true)
    })

    it("should return false for anthropic (not yet supported)", () => {
      expect(registry.isSupportedProvider("anthropic")).toBe(false)
    })

    it("should return false for unknown provider", () => {
      expect(registry.isSupportedProvider("unknown")).toBe(false)
    })
  })

  describe("getModel", () => {
    it("should throw for unsupported provider", () => {
      expect(() => registry.getModel("anthropic:claude-3")).toThrow(
        'Unsupported provider: "anthropic"',
      )
    })

    it("should throw when openrouter not configured", () => {
      expect(() => registry.getModel("openrouter:anthropic/claude-3-haiku")).toThrow(
        "OpenRouter is not configured",
      )
    })
  })

  describe("getLangChainModel", () => {
    it("should throw for unsupported provider", () => {
      expect(() => registry.getLangChainModel("anthropic:claude-3")).toThrow(
        'Unsupported provider: "anthropic"',
      )
    })

    it("should throw when openrouter not configured", () => {
      expect(() => registry.getLangChainModel("openrouter:anthropic/claude-3-haiku")).toThrow(
        "OpenRouter is not configured",
      )
    })
  })

  describe("hasConfiguredProviders", () => {
    it("should return false when no providers configured", () => {
      expect(registry.hasConfiguredProviders()).toBe(false)
    })

    it("should return true when openrouter configured", () => {
      const configuredRegistry = new ProviderRegistry({
        openrouter: { apiKey: "test-key" },
      })
      expect(configuredRegistry.hasConfiguredProviders()).toBe(true)
    })
  })
})
