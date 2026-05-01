import { describe, test, expect, mock } from "bun:test"
import worker from "./index"

const REGIONS_JSON = JSON.stringify({
  "eu-north-1": {
    apiUrl: "http://eu-north-1.backend:3002",
    wsUrl: "ws://eu-north-1.backend:3002",
  },
  local: {
    apiUrl: "http://localhost:3002",
    wsUrl: "ws://localhost:3002",
  },
})

function makeEnv(
  overrides: Partial<{
    WORKSPACE_REGIONS: any
    REGIONS: string
    CONTROL_PLANE_URL: string
    INTERNAL_API_KEY: string
  }> = {}
) {
  return {
    WORKSPACE_REGIONS: {
      get: mock(() => Promise.resolve(null)),
      put: mock(() => Promise.resolve()),
    },
    REGIONS: REGIONS_JSON,
    ...overrides,
  } as any
}

/** Env with KV returning a known region for workspace routing tests */
function makeEnvWithKv(region = "local", overrides: Parameters<typeof makeEnv>[0] = {}) {
  return makeEnv({
    WORKSPACE_REGIONS: {
      get: mock(() => Promise.resolve(region)),
      put: mock(() => Promise.resolve()),
    },
    ...overrides,
  })
}

function makeRequest(path: string, method = "GET") {
  return new Request(`http://localhost:3001${path}`, { method })
}

function mockFetchFn(response = new Response("ok")) {
  const fn = mock(() => Promise.resolve(response))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.fetch = fn as any
  return fn
}

function getProxiedUrl(fn: ReturnType<typeof mock>): string {
  return (fn.mock.calls[0] as unknown as [string, ...unknown[]])[0]
}

function getProxiedInit(fn: ReturnType<typeof mock>): RequestInit {
  return (fn.mock.calls[0] as unknown as [string, RequestInit])[1]
}

async function getJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

describe("workspace-router", () => {
  describe("health check", () => {
    test("GET /readyz returns 200 OK", async () => {
      const res = await worker.fetch(makeRequest("/readyz"), makeEnv())
      expect(res.status).toBe(200)
      expect(await res.text()).toBe("OK")
    })

    test("POST /readyz returns 404 (only GET handled)", async () => {
      const res = await worker.fetch(makeRequest("/readyz", "POST"), makeEnv())
      expect(res.status).toBe(404)
    })
  })

  describe("config endpoint", () => {
    test("returns region and wsUrl for workspace with KV entry", async () => {
      const env = makeEnvWithKv("eu-north-1")
      const res = await worker.fetch(makeRequest("/api/workspaces/ws_123/config"), env)
      expect(res.status).toBe(200)
      expect(await getJson<{ region: string; wsUrl: string }>(res)).toEqual({
        region: "eu-north-1",
        wsUrl: "ws://eu-north-1.backend:3002",
      })
    })

    test("falls back to control-plane when workspace not in KV", async () => {
      const originalFetch = globalThis.fetch
      // Mock the control-plane internal API response, then the proxy response
      const fn = mock(() => Promise.resolve(Response.json({ region: "eu-north-1" })))
      globalThis.fetch = fn as any
      try {
        const env = makeEnv({
          CONTROL_PLANE_URL: "http://localhost:3003",
          INTERNAL_API_KEY: "test-key",
        })
        const res = await worker.fetch(makeRequest("/api/workspaces/ws_unknown/config"), env)
        expect(res.status).toBe(200)
        expect(await getJson<{ region: string; wsUrl: string }>(res)).toEqual({
          region: "eu-north-1",
          wsUrl: "ws://eu-north-1.backend:3002",
        })
        // Verify it called the control-plane internal API
        expect(getProxiedUrl(fn)).toBe("http://localhost:3003/internal/workspaces/ws_unknown/region")
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("returns 404 when workspace not in KV and no control-plane", async () => {
      const res = await worker.fetch(makeRequest("/api/workspaces/ws_123/config"), makeEnv())
      expect(res.status).toBe(404)
      expect(await getJson<{ error: string }>(res)).toEqual({ error: "Workspace not found" })
    })

    test("returns 502 when region is not in REGIONS map", async () => {
      const env = makeEnvWithKv("ap-southeast-1")
      const res = await worker.fetch(makeRequest("/api/workspaces/ws_123/config"), env)
      expect(res.status).toBe(502)
      expect(await getJson<{ error: string }>(res)).toEqual({ error: "Region not configured" })
    })

    test("only responds to GET", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn(new Response("proxied"))
      try {
        // POST to /config falls through to workspace route matching, which proxies to the region
        await worker.fetch(makeRequest("/api/workspaces/ws_123/config", "POST"), makeEnvWithKv())
        expect(fn).toHaveBeenCalled()
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe("workspace-scoped routing", () => {
    test("proxies workspace API requests to correct region", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn(new Response('{"ok":true}', { status: 200 }))
      try {
        const env = makeEnvWithKv("eu-north-1")
        await worker.fetch(makeRequest("/api/workspaces/ws_123/messages"), env)

        expect(fn).toHaveBeenCalledTimes(1)
        expect(getProxiedUrl(fn)).toBe("http://eu-north-1.backend:3002/api/workspaces/ws_123/messages")
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("returns 404 when workspace not in KV and no control-plane", async () => {
      const res = await worker.fetch(makeRequest("/api/workspaces/ws_unknown/streams"), makeEnv())
      expect(res.status).toBe(404)
      expect(await getJson<{ error: string }>(res)).toEqual({ error: "Workspace not found" })
    })

    test("routes /api/workspaces/:workspaceId (no trailing path) by workspace region", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        const env = makeEnvWithKv("eu-north-1")
        await worker.fetch(makeRequest("/api/workspaces/ws_123"), env)
        expect(getProxiedUrl(fn)).toBe("http://eu-north-1.backend:3002/api/workspaces/ws_123")
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe("avatar routing", () => {
    test("proxies avatar requests via workspace-scoped path", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn(new Response("image-data"))
      try {
        const env = makeEnvWithKv("eu-north-1")
        await worker.fetch(makeRequest("/api/workspaces/ws_123/files/avatars/mem_456/avatar.png"), env)
        expect(getProxiedUrl(fn)).toBe(
          "http://eu-north-1.backend:3002/api/workspaces/ws_123/files/avatars/mem_456/avatar.png"
        )
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe("dev workspace routing", () => {
    test("proxies /api/dev/workspaces/:id/join to regional backend", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        const env = makeEnvWithKv("eu-north-1")
        await worker.fetch(makeRequest("/api/dev/workspaces/ws_123/join", "POST"), env)
        expect(getProxiedUrl(fn)).toBe("http://eu-north-1.backend:3002/api/dev/workspaces/ws_123/join")
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("proxies /api/dev/workspaces/:id/streams/:streamId/join to regional backend", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        const env = makeEnvWithKv("local")
        await worker.fetch(makeRequest("/api/dev/workspaces/ws_123/streams/stream_456/join", "POST"), env)
        expect(getProxiedUrl(fn)).toBe("http://localhost:3002/api/dev/workspaces/ws_123/streams/stream_456/join")
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe("non-workspace routes (no control-plane)", () => {
    test("auth routes return 404 when no CONTROL_PLANE_URL", async () => {
      const res = await worker.fetch(makeRequest("/api/auth/login"), makeEnv())
      expect(res.status).toBe(404)
      expect(await getJson<{ error: string }>(res)).toEqual({ error: "Not found" })
    })

    test("workspace list returns 404 when no CONTROL_PLANE_URL", async () => {
      const res = await worker.fetch(makeRequest("/api/workspaces"), makeEnv())
      expect(res.status).toBe(404)
      expect(await getJson<{ error: string }>(res)).toEqual({ error: "Not found" })
    })

    test("unknown paths return 404", async () => {
      const res = await worker.fetch(makeRequest("/api/unknown"), makeEnv())
      expect(res.status).toBe(404)
      expect(await getJson<{ error: string }>(res)).toEqual({ error: "Not found" })
    })
  })

  describe("control-plane routing", () => {
    const CP_URL = "http://localhost:3003"

    test("proxies /api/auth/login to control-plane", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        await worker.fetch(makeRequest("/api/auth/login"), makeEnv({ CONTROL_PLANE_URL: CP_URL }))
        expect(getProxiedUrl(fn)).toBe("http://localhost:3003/api/auth/login")
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("proxies /api/auth/callback to control-plane", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        await worker.fetch(makeRequest("/api/auth/callback?code=abc"), makeEnv({ CONTROL_PLANE_URL: CP_URL }))
        expect(getProxiedUrl(fn)).toBe("http://localhost:3003/api/auth/callback?code=abc")
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("proxies integration callbacks to control-plane", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        await worker.fetch(
          makeRequest("/api/integrations/github/callback?installation_id=1&state=ws_123.1.sig"),
          makeEnv({ CONTROL_PLANE_URL: CP_URL })
        )
        expect(getProxiedUrl(fn)).toBe(
          "http://localhost:3003/api/integrations/github/callback?installation_id=1&state=ws_123.1.sig"
        )
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("proxies /api/auth/logout to control-plane", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        await worker.fetch(makeRequest("/api/auth/logout"), makeEnv({ CONTROL_PLANE_URL: CP_URL }))
        expect(getProxiedUrl(fn)).toBe("http://localhost:3003/api/auth/logout")
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("proxies /api/auth/me to control-plane", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        await worker.fetch(makeRequest("/api/auth/me"), makeEnv({ CONTROL_PLANE_URL: CP_URL }))
        expect(getProxiedUrl(fn)).toBe("http://localhost:3003/api/auth/me")
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("proxies GET /api/workspaces to control-plane", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        await worker.fetch(makeRequest("/api/workspaces"), makeEnv({ CONTROL_PLANE_URL: CP_URL }))
        expect(getProxiedUrl(fn)).toBe("http://localhost:3003/api/workspaces")
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("proxies POST /api/workspaces to control-plane", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        await worker.fetch(makeRequest("/api/workspaces", "POST"), makeEnv({ CONTROL_PLANE_URL: CP_URL }))
        expect(getProxiedUrl(fn)).toBe("http://localhost:3003/api/workspaces")
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("proxies GET /api/regions to control-plane", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        await worker.fetch(makeRequest("/api/regions"), makeEnv({ CONTROL_PLANE_URL: CP_URL }))
        expect(getProxiedUrl(fn)).toBe("http://localhost:3003/api/regions")
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("proxies /test-auth-login to control-plane", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        await worker.fetch(makeRequest("/test-auth-login"), makeEnv({ CONTROL_PLANE_URL: CP_URL }))
        expect(getProxiedUrl(fn)).toBe("http://localhost:3003/test-auth-login")
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("proxies /api/dev/login to control-plane", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        await worker.fetch(makeRequest("/api/dev/login", "POST"), makeEnv({ CONTROL_PLANE_URL: CP_URL }))
        expect(getProxiedUrl(fn)).toBe("http://localhost:3003/api/dev/login")
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("does NOT proxy workspace-scoped routes to control-plane", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        // KV returns region so the route goes to the regional backend, not control-plane
        const env = makeEnvWithKv("local", { CONTROL_PLANE_URL: CP_URL })
        await worker.fetch(makeRequest("/api/workspaces/ws_123/messages"), env)
        expect(getProxiedUrl(fn)).toBe("http://localhost:3002/api/workspaces/ws_123/messages")
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe("proxy headers", () => {
    test("sets X-Forwarded-Host and X-Forwarded-Proto", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        await worker.fetch(makeRequest("/api/workspaces/ws_123/messages"), makeEnvWithKv())
        const headers = new Headers(getProxiedInit(fn).headers as Record<string, string>)
        expect(headers.get("X-Forwarded-Host")).toBe("localhost:3001")
        expect(headers.get("X-Forwarded-Proto")).toBe("http")
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("preserves upstream X-Forwarded-Host and X-Forwarded-Proto for local dev targets", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        const req = new Request("http://localhost:3001/api/workspaces/ws_123/messages", {
          headers: {
            "X-Forwarded-Host": "100.112.117.108:3000",
            "X-Forwarded-Proto": "http",
            "X-Forwarded-Port": "3000",
          },
        })
        await worker.fetch(req, makeEnvWithKv())
        const headers = new Headers(getProxiedInit(fn).headers as Record<string, string>)
        expect(headers.get("X-Forwarded-Host")).toBe("100.112.117.108:3000")
        expect(headers.get("X-Forwarded-Proto")).toBe("http")
        expect(headers.get("X-Forwarded-Port")).toBe("3000")
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("ignores spoofed upstream forwarding headers for remote targets", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        const req = new Request("https://app.threa.io/api/workspaces/ws_123/messages", {
          headers: {
            "X-Forwarded-Host": "evil.example",
            "X-Forwarded-Proto": "http",
            "X-Forwarded-Port": "1234",
          },
        })
        await worker.fetch(req, makeEnvWithKv("eu-north-1"))
        const headers = new Headers(getProxiedInit(fn).headers as Record<string, string>)
        expect(headers.get("X-Forwarded-Host")).toBe("app.threa.io")
        expect(headers.get("X-Forwarded-Proto")).toBe("https")
        expect(headers.get("X-Forwarded-Port")).toBeNull()
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("forwards CF-Connecting-IP as X-Forwarded-For", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        const req = new Request("http://localhost:3001/api/workspaces/ws_123/messages", {
          headers: { "CF-Connecting-IP": "203.0.113.42" },
        })
        await worker.fetch(req, makeEnvWithKv())
        const headers = new Headers(getProxiedInit(fn).headers as Record<string, string>)
        expect(headers.get("X-Forwarded-For")).toBe("203.0.113.42")
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("strips client-supplied X-Forwarded-For when CF-Connecting-IP is absent", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        const req = new Request("http://localhost:3001/api/workspaces/ws_123/messages", {
          headers: { "X-Forwarded-For": "attacker-spoofed-ip" },
        })
        await worker.fetch(req, makeEnvWithKv())
        const headers = new Headers(getProxiedInit(fn).headers as Record<string, string>)
        expect(headers.get("X-Forwarded-For")).toBeNull()
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("preserves query string through proxy", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        await worker.fetch(makeRequest("/api/workspaces/ws_123/messages?limit=50&before=abc"), makeEnvWithKv())
        expect(getProxiedUrl(fn)).toBe("http://localhost:3002/api/workspaces/ws_123/messages?limit=50&before=abc")
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe("REGIONS validation", () => {
    test("throws on empty REGIONS", async () => {
      expect(() => worker.fetch(makeRequest("/readyz"), makeEnv({ REGIONS: "" }))).toThrow(
        "REGIONS env var is empty or missing"
      )
    })

    test("throws on invalid JSON", async () => {
      expect(() => worker.fetch(makeRequest("/readyz"), makeEnv({ REGIONS: "not-json" }))).toThrow(
        "REGIONS env var is not valid JSON"
      )
    })
  })
})
