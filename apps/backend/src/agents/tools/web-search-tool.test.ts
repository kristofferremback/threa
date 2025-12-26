import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test"
import { createWebSearchTool } from "./web-search-tool"

describe("web-search-tool", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("should return search results on successful API call", async () => {
    const mockResponse = {
      query: "test query",
      answer: "This is the answer",
      results: [
        { title: "Result 1", url: "https://example.com/1", content: "Content 1", score: 0.9 },
        { title: "Result 2", url: "https://example.com/2", content: "Content 2", score: 0.8 },
      ],
      response_time: 0.5,
    }

    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response)
    )

    const tool = createWebSearchTool({ tavilyApiKey: "test-api-key" })
    const result = await tool.invoke({ query: "test query" })
    const parsed = JSON.parse(result)

    expect(parsed.query).toBe("test query")
    expect(parsed.answer).toBe("This is the answer")
    expect(parsed.results).toHaveLength(2)
    expect(parsed.results[0].title).toBe("Result 1")
    expect(parsed.results[0].url).toBe("https://example.com/1")
  })

  it("should send correct headers and body to Tavily API", async () => {
    let capturedRequest: { url: string; options: RequestInit } | null = null

    globalThis.fetch = mock((url: string, options: RequestInit) => {
      capturedRequest = { url, options }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ query: "test", results: [], response_time: 0.1 }),
      } as Response)
    })

    const tool = createWebSearchTool({ tavilyApiKey: "test-api-key" })
    await tool.invoke({ query: "test query" })

    expect(capturedRequest).not.toBeNull()
    expect(capturedRequest!.url).toBe("https://api.tavily.com/search")
    expect(capturedRequest!.options.method).toBe("POST")
    expect(capturedRequest!.options.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer test-api-key",
    })

    const body = JSON.parse(capturedRequest!.options.body as string)
    expect(body.query).toBe("test query")
    expect(body.max_results).toBe(5)
    expect(body.include_answer).toBe(true)
  })

  it("should return error on API failure", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      } as Response)
    )

    const tool = createWebSearchTool({ tavilyApiKey: "invalid-key" })
    const result = await tool.invoke({ query: "test" })
    const parsed = JSON.parse(result)

    expect(parsed.error).toContain("Search failed: 401")
    expect(parsed.query).toBe("test")
  })

  it("should return error on network failure", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("Network error")))

    const tool = createWebSearchTool({ tavilyApiKey: "test-key" })
    const result = await tool.invoke({ query: "test" })
    const parsed = JSON.parse(result)

    expect(parsed.error).toContain("Network error")
  })

  it("should respect maxResults parameter", async () => {
    let capturedBody: Record<string, unknown> | null = null

    globalThis.fetch = mock((_url: string, options: RequestInit) => {
      capturedBody = JSON.parse(options.body as string)
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ query: "test", results: [], response_time: 0.1 }),
      } as Response)
    })

    const tool = createWebSearchTool({ tavilyApiKey: "test-key", maxResults: 10 })
    await tool.invoke({ query: "test" })

    expect(capturedBody).not.toBeNull()
    expect(capturedBody!.max_results).toBe(10)
  })
})
