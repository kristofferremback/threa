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
    DEFAULT_REGION: string
    CONTROL_PLANE_URL: string
  }> = {}
) {
  return {
    WORKSPACE_REGIONS: {
      get: mock(() => Promise.resolve(null)),
    },
    REGIONS: REGIONS_JSON,
    DEFAULT_REGION: "local",
    ...overrides,
  } as any
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

describe("workspace-router", () => {
  describe("health check", () => {
    test("GET /readyz returns 200 OK", async () => {
      const res = await worker.fetch(makeRequest("/readyz"), makeEnv())
      expect(res.status).toBe(200)
      expect(await res.text()).toBe("OK")
    })

    test("POST /readyz falls through to default region", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn(new Response("proxied"))
      try {
        await worker.fetch(makeRequest("/readyz", "POST"), makeEnv())
        // POST /readyz is not the health check — routes to default region
        expect(fn).toHaveBeenCalled()
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe("config endpoint", () => {
    test("returns region and wsUrl for workspace with KV entry", async () => {
      const env = makeEnv({
        WORKSPACE_REGIONS: { get: mock(() => Promise.resolve("eu-north-1")) },
      })
      const res = await worker.fetch(makeRequest("/api/workspaces/ws_123/config"), env)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        region: "eu-north-1",
        wsUrl: "ws://eu-north-1.backend:3002",
      })
    })

    test("falls back to DEFAULT_REGION when workspace not in KV", async () => {
      const res = await worker.fetch(makeRequest("/api/workspaces/ws_unknown/config"), makeEnv())
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        region: "local",
        wsUrl: "ws://localhost:3002",
      })
    })

    test("returns 404 when no KV entry and no default region", async () => {
      const env = makeEnv({ DEFAULT_REGION: undefined })
      const res = await worker.fetch(makeRequest("/api/workspaces/ws_123/config"), env)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: "Workspace not found" })
    })

    test("returns 502 when region is not in REGIONS map", async () => {
      const env = makeEnv({
        WORKSPACE_REGIONS: { get: mock(() => Promise.resolve("ap-southeast-1")) },
      })
      const res = await worker.fetch(makeRequest("/api/workspaces/ws_123/config"), env)
      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ error: "Region not configured" })
    })

    test("only responds to GET", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn(new Response("proxied"))
      try {
        // POST to /config should fall through to workspace route matching
        await worker.fetch(makeRequest("/api/workspaces/ws_123/config", "POST"), makeEnv())
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
        const env = makeEnv({
          WORKSPACE_REGIONS: { get: mock(() => Promise.resolve("eu-north-1")) },
        })
        await worker.fetch(makeRequest("/api/workspaces/ws_123/messages"), env)

        expect(fn).toHaveBeenCalledTimes(1)
        expect(getProxiedUrl(fn)).toBe("http://eu-north-1.backend:3002/api/workspaces/ws_123/messages")
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("proxies to default region when workspace not in KV", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        await worker.fetch(makeRequest("/api/workspaces/ws_unknown/streams"), makeEnv())
        expect(getProxiedUrl(fn)).toBe("http://localhost:3002/api/workspaces/ws_unknown/streams")
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("routes /api/workspaces/:workspaceId (no trailing path) by workspace region", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        const env = makeEnv({
          WORKSPACE_REGIONS: { get: mock(() => Promise.resolve("eu-north-1")) },
        })
        await worker.fetch(makeRequest("/api/workspaces/ws_123"), env)
        expect(getProxiedUrl(fn)).toBe("http://eu-north-1.backend:3002/api/workspaces/ws_123")
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("returns 404 for workspace route with no region", async () => {
      const env = makeEnv({ DEFAULT_REGION: undefined })
      const res = await worker.fetch(makeRequest("/api/workspaces/ws_123/messages"), env)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: "Workspace not found" })
    })
  })

  describe("avatar routing", () => {
    test("proxies avatar requests via workspace-scoped path", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn(new Response("image-data"))
      try {
        const env = makeEnv({
          WORKSPACE_REGIONS: { get: mock(() => Promise.resolve("eu-north-1")) },
        })
        await worker.fetch(makeRequest("/api/workspaces/ws_123/files/avatars/mem_456/avatar.png"), env)
        expect(getProxiedUrl(fn)).toBe(
          "http://eu-north-1.backend:3002/api/workspaces/ws_123/files/avatars/mem_456/avatar.png"
        )
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe("non-workspace routes (no control-plane)", () => {
    test("proxies auth routes to default region when no CONTROL_PLANE_URL", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn()
      try {
        await worker.fetch(makeRequest("/api/auth/login", "POST"), makeEnv())
        expect(getProxiedUrl(fn)).toBe("http://localhost:3002/api/auth/login")
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("returns 404 for non-workspace routes with no default region", async () => {
      const env = makeEnv({ DEFAULT_REGION: undefined })
      const res = await worker.fetch(makeRequest("/api/auth/login"), env)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: "No default region configured" })
    })

    test("proxies /api/workspaces (list) to default region when no CONTROL_PLANE_URL", async () => {
      const originalFetch = globalThis.fetch
      const fn = mockFetchFn(new Response("[]"))
      try {
        await worker.fetch(makeRequest("/api/workspaces"), makeEnv())
        expect(getProxiedUrl(fn)).toBe("http://localhost:3002/api/workspaces")
      } finally {
        globalThis.fetch = originalFetch
      }
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
        await worker.fetch(makeRequest("/api/workspaces/ws_123/messages"), makeEnv({ CONTROL_PLANE_URL: CP_URL }))
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
        await worker.fetch(makeRequest("/api/workspaces/ws_123/messages"), makeEnv())
        const headers = new Headers(getProxiedInit(fn).headers as Record<string, string>)
        expect(headers.get("X-Forwarded-Host")).toBe("localhost:3001")
        expect(headers.get("X-Forwarded-Proto")).toBe("http")
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
        await worker.fetch(req, makeEnv())
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
        await worker.fetch(req, makeEnv())
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
        await worker.fetch(makeRequest("/api/workspaces/ws_123/messages?limit=50&before=abc"), makeEnv())
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
