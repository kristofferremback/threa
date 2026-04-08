import { afterEach, describe, expect, mock, test } from "bun:test"
import { createIntegrationHandlers } from "./handlers"

function createResponse() {
  const res: any = {
    statusCode: 200,
    headers: new Map<string, string>(),
  }
  res.status = mock((code: number) => {
    res.statusCode = code
    return res
  })
  res.setHeader = mock((key: string, value: string) => {
    res.headers.set(key.toLowerCase(), value)
    return res
  })
  res.send = mock((body?: unknown) => {
    res.body = body
    return res
  })
  res.json = mock((body: unknown) => {
    res.body = body
    return res
  })
  return res
}

describe("integration callback proxy", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("relays backend redirects instead of following them", async () => {
    const workspaceService = {
      getRegion: mock(async () => "local"),
    } as any

    const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual")
      return new Response(null, {
        status: 302,
        headers: {
          Location: "http://localhost:3000/w/ws_123?ws-settings=integrations&provider=github",
        },
      })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const handlers = createIntegrationHandlers({
      workspaceService,
      regions: {
        local: { internalUrl: "http://localhost:3002" },
      },
    })
    const res = createResponse()

    await handlers.githubCallback(
      {
        query: { state: "ws_123.1.sig" },
        originalUrl: "/api/integrations/github/callback?state=ws_123.1.sig",
        method: "GET",
        headers: {
          host: "localhost:3003",
          "x-forwarded-host": "localhost:3000",
          "x-forwarded-proto": "http",
        },
        get(name: string) {
          const key = name.toLowerCase()
          const value = (this.headers as Record<string, string | undefined>)[key]
          return value
        },
        protocol: "http",
      } as any,
      res
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBe(302)
    expect(res.headers.get("location")).toBe("http://localhost:3000/w/ws_123?ws-settings=integrations&provider=github")
  })
})
