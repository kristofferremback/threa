/**
 * Text Processing Utilities Tests
 */

import { describe, test, expect } from "bun:test"
import { stripMarkdownFences } from "./text-utils"

describe("stripMarkdownFences", () => {
  test("removes ```json fence", async () => {
    const input = '```json\n{"key": "value"}\n```'
    const result = await stripMarkdownFences({ text: input })
    expect(result).toBe('{"key": "value"}')
  })

  test("removes plain ``` fence", async () => {
    const input = '```\n{"key": "value"}\n```'
    const result = await stripMarkdownFences({ text: input })
    expect(result).toBe('{"key": "value"}')
  })

  test("handles leading whitespace before fence", async () => {
    const input = '  \n```json\n{"key": "value"}\n```'
    const result = await stripMarkdownFences({ text: input })
    expect(result).toBe('{"key": "value"}')
  })

  test("handles missing closing fence", async () => {
    const input = '```json\n{"key": "value"}'
    const result = await stripMarkdownFences({ text: input })
    expect(result).toBe('{"key": "value"}')
  })

  test("handles trailing whitespace after closing fence", async () => {
    const input = '```json\n{"key": "value"}\n```  \n'
    const result = await stripMarkdownFences({ text: input })
    expect(result).toBe('{"key": "value"}')
  })

  test("preserves content without fences", async () => {
    const input = '{"key": "value"}'
    const result = await stripMarkdownFences({ text: input })
    expect(result).toBe('{"key": "value"}')
  })

  test("handles case-insensitive JSON marker", async () => {
    const input = '```JSON\n{"key": "value"}\n```'
    const result = await stripMarkdownFences({ text: input })
    expect(result).toBe('{"key": "value"}')
  })

  test("preserves multiline content", async () => {
    const input = '```json\n{\n  "key": "value",\n  "nested": {\n    "a": 1\n  }\n}\n```'
    const result = await stripMarkdownFences({ text: input })
    expect(result).toBe('{\n  "key": "value",\n  "nested": {\n    "a": 1\n  }\n}')
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
})
