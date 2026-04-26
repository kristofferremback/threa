import { describe, expect, test } from "bun:test"
import {
  LINEAR_OAUTH_SCOPE_STRING,
  buildLinearAuthorizationUrl,
  exchangeLinearCode,
  expiresAtFromNow,
  refreshLinearToken,
  revokeLinearToken,
} from "./linear-oauth"

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  })
}

describe("buildLinearAuthorizationUrl", () => {
  test("includes every required OAuth parameter with actor=app", () => {
    const url = new URL(
      buildLinearAuthorizationUrl({
        clientId: "client_123",
        redirectUri: "https://threa.example/api/integrations/linear/callback",
        state: "ws_abc.123.deadbeef",
      })
    )

    expect(url.origin + url.pathname).toBe("https://linear.app/oauth/authorize")
    expect(url.searchParams.get("client_id")).toBe("client_123")
    expect(url.searchParams.get("redirect_uri")).toBe("https://threa.example/api/integrations/linear/callback")
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("scope")).toBe(LINEAR_OAUTH_SCOPE_STRING)
    expect(url.searchParams.get("state")).toBe("ws_abc.123.deadbeef")
    expect(url.searchParams.get("actor")).toBe("app")
    expect(url.searchParams.get("prompt")).toBe("consent")
  })

  test("requests the read + agent scopes; intentionally omits admin", () => {
    expect(LINEAR_OAUTH_SCOPE_STRING.split(",")).toEqual(["read", "app:assignable", "app:mentionable"])
    expect(LINEAR_OAUTH_SCOPE_STRING).not.toContain("admin")
  })
})

describe("exchangeLinearCode", () => {
  test("POSTs a form-encoded authorization_code body and parses the token response", async () => {
    const captured: { url: string; body: URLSearchParams; contentType: string } = {
      url: "",
      body: new URLSearchParams(),
      contentType: "",
    }

    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = input.toString()
      captured.contentType = (init?.headers as Record<string, string> | undefined)?.["Content-Type"] ?? ""
      captured.body = new URLSearchParams(init?.body as string)
      return jsonResponse({
        access_token: "at_123",
        refresh_token: "rt_123",
        token_type: "Bearer",
        expires_in: 86399,
        scope: "read,app:assignable,app:mentionable",
      })
    }) as unknown as typeof fetch

    const tokens = await exchangeLinearCode({
      clientId: "client_123",
      clientSecret: "secret_456",
      redirectUri: "https://threa.example/api/integrations/linear/callback",
      code: "auth_code_789",
      fetchImpl: fakeFetch,
    })

    expect(captured.url).toBe("https://api.linear.app/oauth/token")
    expect(captured.contentType).toBe("application/x-www-form-urlencoded")
    expect(captured.body.get("grant_type")).toBe("authorization_code")
    expect(captured.body.get("code")).toBe("auth_code_789")
    expect(captured.body.get("client_id")).toBe("client_123")
    expect(captured.body.get("client_secret")).toBe("secret_456")

    expect(tokens).toEqual({
      accessToken: "at_123",
      refreshToken: "rt_123",
      tokenType: "Bearer",
      expiresIn: 86399,
      scope: "read,app:assignable,app:mentionable",
    })
  })

  test("throws a descriptive error when Linear returns a non-2xx", async () => {
    const fakeFetch = (async () => new Response("invalid_grant", { status: 400 })) as unknown as typeof fetch
    await expect(
      exchangeLinearCode({
        clientId: "c",
        clientSecret: "s",
        redirectUri: "r",
        code: "bad",
        fetchImpl: fakeFetch,
      })
    ).rejects.toThrow(/status 400/)
  })

  test("throws when the token response is missing access_token", async () => {
    const fakeFetch = (async () => jsonResponse({ token_type: "Bearer", expires_in: 100 })) as unknown as typeof fetch
    await expect(
      exchangeLinearCode({ clientId: "c", clientSecret: "s", redirectUri: "r", code: "x", fetchImpl: fakeFetch })
    ).rejects.toThrow(/missing access_token/)
  })
})

describe("refreshLinearToken", () => {
  test("POSTs a refresh_token body and returns the refreshed tokens", async () => {
    const captured = { body: new URLSearchParams() }
    const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.body = new URLSearchParams(init?.body as string)
      return jsonResponse({
        access_token: "at_new",
        refresh_token: "rt_new",
        token_type: "Bearer",
        expires_in: 86399,
        scope: "read,app:assignable",
      })
    }) as unknown as typeof fetch

    const tokens = await refreshLinearToken({
      clientId: "c",
      clientSecret: "s",
      refreshToken: "rt_old",
      fetchImpl: fakeFetch,
    })

    expect(captured.body.get("grant_type")).toBe("refresh_token")
    expect(captured.body.get("refresh_token")).toBe("rt_old")
    expect(tokens.accessToken).toBe("at_new")
    expect(tokens.refreshToken).toBe("rt_new")
  })
})

describe("revokeLinearToken", () => {
  test("treats 200 and 400 as success (400 = already revoked)", async () => {
    for (const status of [200, 400]) {
      const fakeFetch = (async () => new Response("", { status })) as unknown as typeof fetch
      await expect(revokeLinearToken({ accessToken: "at_123", fetchImpl: fakeFetch })).resolves.toBeUndefined()
    }
  })

  test("throws on unexpected status", async () => {
    const fakeFetch = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch
    await expect(revokeLinearToken({ accessToken: "at_123", fetchImpl: fakeFetch })).rejects.toThrow(/status 500/)
  })
})

describe("expiresAtFromNow", () => {
  test("converts seconds-from-now to an ISO timestamp", () => {
    const nowMs = Date.UTC(2026, 3, 22, 10, 0, 0)
    expect(expiresAtFromNow(3600, nowMs)).toBe("2026-04-22T11:00:00.000Z")
  })
})
