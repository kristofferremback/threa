/**
 * Text Processing Utilities Tests
 */

import { describe, test, expect } from "bun:test"
import { stripMarkdownFences } from "./text-utils"

describe("stripMarkdownFences", () => {
  test("removes ```json fence and normalizes JSON", async () => {
    const input = '```json\n{"key": "value"}\n```'
    const result = await stripMarkdownFences({ text: input })
    // Now parses and re-serializes, adding defaults
    expect(result).toBe('{"key":"value","confidence":0.5}')
  })

  test("removes plain ``` fence", async () => {
    const input = '```\n{"key": "value"}\n```'
    const result = await stripMarkdownFences({ text: input })
    expect(result).toBe('{"key":"value","confidence":0.5}')
  })

  test("handles leading whitespace before fence", async () => {
    const input = '  \n```json\n{"key": "value"}\n```'
    const result = await stripMarkdownFences({ text: input })
    expect(result).toBe('{"key":"value","confidence":0.5}')
  })

  test("handles missing closing fence", async () => {
    const input = '```json\n{"key": "value"}'
    const result = await stripMarkdownFences({ text: input })
    expect(result).toBe('{"key":"value","confidence":0.5}')
  })

  test("handles trailing whitespace after closing fence", async () => {
    const input = '```json\n{"key": "value"}\n```  \n'
    const result = await stripMarkdownFences({ text: input })
    expect(result).toBe('{"key":"value","confidence":0.5}')
  })

  test("preserves content without fences", async () => {
    const input = '{"key": "value"}'
    const result = await stripMarkdownFences({ text: input })
    expect(result).toBe('{"key":"value","confidence":0.5}')
  })

  test("handles case-insensitive JSON marker", async () => {
    const input = '```JSON\n{"key": "value"}\n```'
    const result = await stripMarkdownFences({ text: input })
    expect(result).toBe('{"key":"value","confidence":0.5}')
  })

  test("preserves nested structure", async () => {
    const input = '```json\n{"key": "value", "nested": {"a": 1}}\n```'
    const result = await stripMarkdownFences({ text: input })
    expect(result).toBe('{"key":"value","nested":{"a":1},"confidence":0.5}')
  })

  test("handles empty content", async () => {
    const input = ""
    const result = await stripMarkdownFences({ text: input })
    expect(result).toBe("")
  })

  test("handles only fences with no content", async () => {
    const input = "```json\n```"
    const result = await stripMarkdownFences({ text: input })
    expect(result).toBe("")
  })

  test("converts snake_case to camelCase", async () => {
    const input = '{"is_gem": false, "knowledge_type": null}'
    const result = await stripMarkdownFences({ text: input })
    expect(result).toBe('{"isGem":false,"knowledgeType":null,"reasoning":null,"confidence":0.5}')
  })

  test("maps classification field to isKnowledgeWorthy", async () => {
    const input = '{"classification": "not_knowledge_worthy", "reasoning": "test"}'
    const result = await stripMarkdownFences({ text: input })
    const parsed = JSON.parse(result)
    expect(parsed.isKnowledgeWorthy).toBe(false)
    expect(parsed.reasoning).toBe("test")
  })

  test("adds defaults for isGem=false", async () => {
    const input = '{"isGem": false, "reasoning": "social chatter"}'
    const result = await stripMarkdownFences({ text: input })
    const parsed = JSON.parse(result)
    expect(parsed.isGem).toBe(false)
    expect(parsed.knowledgeType).toBe(null)
    expect(parsed.confidence).toBe(0.5)
  })

  test("adds defaults for isKnowledgeWorthy=false", async () => {
    const input = '{"isKnowledgeWorthy": false, "reasoning": "banter"}'
    const result = await stripMarkdownFences({ text: input })
    const parsed = JSON.parse(result)
    expect(parsed.isKnowledgeWorthy).toBe(false)
    expect(parsed.shouldReviseExisting).toBe(false)
    expect(parsed.revisionReason).toBe(null)
    expect(parsed.knowledgeType).toBe(null)
  })

  test("preserves existing confidence value", async () => {
    const input = '{"isGem": true, "confidence": 0.95}'
    const result = await stripMarkdownFences({ text: input })
    const parsed = JSON.parse(result)
    expect(parsed.confidence).toBe(0.95)
  })

  test("returns cleaned text if JSON parse fails", async () => {
    const input = "```json\nnot valid json\n```"
    const result = await stripMarkdownFences({ text: input })
    expect(result).toBe("not valid json")
  })
})
