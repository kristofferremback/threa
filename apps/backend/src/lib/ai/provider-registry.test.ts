import { describe, expect, it } from "bun:test"
import { parseProviderModel, isSupportedProvider } from "./provider-registry"

describe("parseProviderModel", () => {
  it("should parse openrouter:model format", () => {
    const result = parseProviderModel("openrouter:anthropic/claude-3-haiku")
    expect(result).toEqual({
      provider: "openrouter",
      modelId: "anthropic/claude-3-haiku",
    })
  })

  it("should parse anthropic:model format", () => {
    const result = parseProviderModel("anthropic:claude-sonnet-4-20250514")
    expect(result).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
    })
  })

  it("should handle model IDs with colons (ollama)", () => {
    const result = parseProviderModel("ollama:granite4:350m")
    expect(result).toEqual({
      provider: "ollama",
      modelId: "granite4:350m",
    })
  })

  it("should throw for missing colon", () => {
    expect(() => parseProviderModel("invalid")).toThrow(
      'Invalid provider:model format: "invalid"',
    )
  })

  it("should throw for empty provider", () => {
    expect(() => parseProviderModel(":model")).toThrow(
      'Invalid provider:model format: ":model"',
    )
  })

  it("should throw for empty model", () => {
    expect(() => parseProviderModel("provider:")).toThrow(
      'Invalid provider:model format: "provider:"',
    )
  })
})

describe("isSupportedProvider", () => {
  it("should return true for openrouter", () => {
    expect(isSupportedProvider("openrouter")).toBe(true)
  })

  it("should return false for anthropic (not yet supported)", () => {
    expect(isSupportedProvider("anthropic")).toBe(false)
  })

  it("should return false for unknown provider", () => {
    expect(isSupportedProvider("unknown")).toBe(false)
  })
})
