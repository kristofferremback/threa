import { describe, expect, test } from "bun:test"
import { buildGithubCallbackRedirectUrl } from "./handlers"

describe("buildGithubCallbackRedirectUrl", () => {
  test("returns an absolute frontend URL when forwarded headers are present", () => {
    const url = buildGithubCallbackRedirectUrl(
      {
        headers: {
          "x-forwarded-host": "localhost:3000",
          "x-forwarded-proto": "http",
        },
        protocol: "http",
      } as any,
      "ws_123"
    )

    expect(url).toBe("http://localhost:3000/w/ws_123?ws-settings=integrations&provider=github")
  })

  test("prefers x-forwarded-port over an intermediate proxy port in the host header", () => {
    const url = buildGithubCallbackRedirectUrl(
      {
        headers: {
          "x-forwarded-host": "localhost:3001",
          "x-forwarded-proto": "http",
          "x-forwarded-port": "3000",
        },
        protocol: "http",
      } as any,
      "ws_123"
    )

    expect(url).toBe("http://localhost:3000/w/ws_123?ws-settings=integrations&provider=github")
  })

  test("falls back to a relative workspace path without forwarded headers", () => {
    const url = buildGithubCallbackRedirectUrl(
      {
        headers: {},
        protocol: "https",
      } as any,
      "ws_123"
    )

    expect(url).toBe("/w/ws_123?ws-settings=integrations&provider=github")
  })
})
