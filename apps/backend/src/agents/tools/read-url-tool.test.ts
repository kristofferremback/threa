import { describe, it, expect, mock, afterEach } from "bun:test"
import { createReadUrlTool } from "./read-url-tool"

describe("read-url-tool", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("should convert HTML to markdown", async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Test Page</title></head>
        <body>
          <h1>Hello World</h1>
          <p>This is a test paragraph.</p>
          <script>console.log('should be removed')</script>
          <style>.hidden { display: none; }</style>
        </body>
      </html>
    `

    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        headers: new Headers({ "content-type": "text/html" }),
        text: () => Promise.resolve(html),
      } as Response)
    )

    const tool = createReadUrlTool()
    const result = await tool.invoke({ url: "https://example.com" })
    const parsed = JSON.parse(result)

    expect(parsed.url).toBe("https://example.com")
    expect(parsed.title).toBe("Test Page")
    expect(parsed.content).toContain("Hello World")
    expect(parsed.content).toContain("This is a test paragraph")
    // Script content should be stripped by node-html-markdown
    expect(parsed.content).not.toContain("should be removed")
  })

  it("should send correct User-Agent header", async () => {
    let capturedHeaders: Record<string, string> | null = null

    globalThis.fetch = mock((_url: string, options: RequestInit) => {
      capturedHeaders = options.headers as Record<string, string>
      return Promise.resolve({
        ok: true,
        headers: new Headers({ "content-type": "text/html" }),
        text: () => Promise.resolve("<html><head><title>Test</title></head><body></body></html>"),
      } as Response)
    })

    const tool = createReadUrlTool()
    await tool.invoke({ url: "https://example.com" })

    expect(capturedHeaders).not.toBeNull()
    expect(capturedHeaders!["User-Agent"]).toContain("Threa-Agent")
  })

  it("should return error for non-HTML content types", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        headers: new Headers({ "content-type": "application/pdf" }),
        text: () => Promise.resolve("binary content"),
      } as Response)
    )

    const tool = createReadUrlTool()
    const result = await tool.invoke({ url: "https://example.com/file.pdf" })
    const parsed = JSON.parse(result)

    expect(parsed.error).toContain("Unsupported content type")
    expect(parsed.error).toContain("application/pdf")
  })

  it("should return error on HTTP failure", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as Response)
    )

    const tool = createReadUrlTool()
    const result = await tool.invoke({ url: "https://example.com/missing" })
    const parsed = JSON.parse(result)

    expect(parsed.error).toContain("Failed to fetch URL: 404 Not Found")
  })

  it("should return error on network failure", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("Connection refused")))

    const tool = createReadUrlTool()
    const result = await tool.invoke({ url: "https://example.com" })
    const parsed = JSON.parse(result)

    expect(parsed.error).toContain("Connection refused")
  })

  it("should truncate very long content", async () => {
    const longContent = "A".repeat(60000)
    const html = `<html><head><title>Test</title></head><body>${longContent}</body></html>`

    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        headers: new Headers({ "content-type": "text/html" }),
        text: () => Promise.resolve(html),
      } as Response)
    )

    const tool = createReadUrlTool()
    const result = await tool.invoke({ url: "https://example.com" })
    const parsed = JSON.parse(result)

    expect(parsed.content.length).toBeLessThan(60000)
    expect(parsed.content).toContain("[Content truncated...]")
  })

  it("should handle plain text content", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        headers: new Headers({ "content-type": "text/plain" }),
        text: () => Promise.resolve("This is plain text content."),
      } as Response)
    )

    const tool = createReadUrlTool()
    const result = await tool.invoke({ url: "https://example.com/file.txt" })
    const parsed = JSON.parse(result)

    expect(parsed.content).toBe("This is plain text content.")
  })

  it("should return timeout error when request takes too long", async () => {
    const abortError = new Error("The operation was aborted")
    abortError.name = "AbortError"

    globalThis.fetch = mock(() => Promise.reject(abortError))

    const tool = createReadUrlTool()
    const result = await tool.invoke({ url: "https://example.com" })
    const parsed = JSON.parse(result)

    expect(parsed.error).toContain("timed out")
  })

  describe("SSRF protection", () => {
    it("should block localhost", async () => {
      const tool = createReadUrlTool()
      const result = await tool.invoke({ url: "http://localhost/admin" })
      const parsed = JSON.parse(result)

      expect(parsed.error).toContain("localhost is not allowed")
    })

    it("should block 127.0.0.1", async () => {
      const tool = createReadUrlTool()
      const result = await tool.invoke({ url: "http://127.0.0.1:8080/secret" })
      const parsed = JSON.parse(result)

      expect(parsed.error).toContain("localhost is not allowed")
    })

    it("should block private 10.x.x.x addresses", async () => {
      const tool = createReadUrlTool()
      const result = await tool.invoke({ url: "http://10.0.0.1/internal" })
      const parsed = JSON.parse(result)

      expect(parsed.error).toContain("private network")
    })

    it("should block private 192.168.x.x addresses", async () => {
      const tool = createReadUrlTool()
      const result = await tool.invoke({ url: "http://192.168.1.1/router" })
      const parsed = JSON.parse(result)

      expect(parsed.error).toContain("private network")
    })

    it("should block private 172.16-31.x.x addresses", async () => {
      const tool = createReadUrlTool()
      const result = await tool.invoke({ url: "http://172.16.0.1/internal" })
      const parsed = JSON.parse(result)

      expect(parsed.error).toContain("private network")
    })

    it("should block cloud metadata endpoints (169.254.x.x)", async () => {
      const tool = createReadUrlTool()
      const result = await tool.invoke({ url: "http://169.254.169.254/latest/meta-data/" })
      const parsed = JSON.parse(result)

      expect(parsed.error).toContain("link-local")
    })

    it("should block .local hostnames", async () => {
      const tool = createReadUrlTool()
      const result = await tool.invoke({ url: "http://internal-service.local/api" })
      const parsed = JSON.parse(result)

      expect(parsed.error).toContain("internal hostnames")
    })

    it("should block .internal hostnames", async () => {
      const tool = createReadUrlTool()
      const result = await tool.invoke({ url: "http://db.internal:5432/" })
      const parsed = JSON.parse(result)

      expect(parsed.error).toContain("internal hostnames")
    })

    it("should block non-HTTP protocols", async () => {
      const tool = createReadUrlTool()
      const result = await tool.invoke({ url: "file:///etc/passwd" })
      const parsed = JSON.parse(result)

      expect(parsed.error).toContain("Unsupported protocol")
    })
  })
})
