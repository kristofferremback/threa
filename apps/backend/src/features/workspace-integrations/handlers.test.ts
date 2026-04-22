import { describe, expect, test } from "bun:test"
import { buildProviderCallbackRedirectUrl } from "./handlers"

describe("buildProviderCallbackRedirectUrl (github)", () => {
  const allowedOrigins = ["http://localhost:3000", "https://app.threa.io"]

  test("returns an absolute frontend URL when the forwarded origin is allowlisted", () => {
    const url = buildProviderCallbackRedirectUrl(
      {
        headers: {
          "x-forwarded-host": "localhost:3000",
          "x-forwarded-proto": "http",
        },
        protocol: "http",
      } as any,
      "ws_123",
      "github",
      allowedOrigins
    )

    expect(url).toBe("http://localhost:3000/w/ws_123?ws-settings=integrations&provider=github")
  })

  test("prefers x-forwarded-port over an intermediate proxy port in the host header", () => {
    const url = buildProviderCallbackRedirectUrl(
      {
        headers: {
          "x-forwarded-host": "localhost:3001",
          "x-forwarded-proto": "http",
          "x-forwarded-port": "3000",
        },
        protocol: "http",
      } as any,
      "ws_123",
      "github",
      allowedOrigins
    )

    expect(url).toBe("http://localhost:3000/w/ws_123?ws-settings=integrations&provider=github")
  })

  test("falls back to a relative workspace path without forwarded headers", () => {
    const url = buildProviderCallbackRedirectUrl(
      {
        headers: {},
        protocol: "https",
      } as any,
      "ws_123",
      "github",
      allowedOrigins
    )

    expect(url).toBe("/w/ws_123?ws-settings=integrations&provider=github")
  })

  test("falls back to a relative path when the forwarded origin is not in the allowlist", () => {
    const url = buildProviderCallbackRedirectUrl(
      {
        headers: {
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "https",
        },
        protocol: "https",
      } as any,
      "ws_123",
      "github",
      allowedOrigins
    )

    expect(url).toBe("/w/ws_123?ws-settings=integrations&provider=github")
  })

  test("falls back to a relative path when the forwarded host is malformed", () => {
    const url = buildProviderCallbackRedirectUrl(
      {
        headers: {
          "x-forwarded-host": "not a valid host",
          "x-forwarded-proto": "https",
        },
        protocol: "https",
      } as any,
      "ws_123",
      "github",
      allowedOrigins
    )

    expect(url).toBe("/w/ws_123?ws-settings=integrations&provider=github")
  })
})

describe("buildProviderCallbackRedirectUrl (linear)", () => {
  const allowedOrigins = ["http://localhost:3000", "https://app.threa.io"]

  test("returns an absolute frontend URL with provider=linear when the forwarded origin is allowlisted", () => {
    const url = buildProviderCallbackRedirectUrl(
      {
        headers: {
          "x-forwarded-host": "app.threa.io",
          "x-forwarded-proto": "https",
        },
        protocol: "https",
      } as any,
      "ws_abc",
      "linear",
      allowedOrigins
    )

    expect(url).toBe("https://app.threa.io/w/ws_abc?ws-settings=integrations&provider=linear")
  })

  test("falls back to a relative workspace path with provider=linear when the forwarded origin is not allowlisted", () => {
    const url = buildProviderCallbackRedirectUrl(
      {
        headers: {
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "https",
        },
        protocol: "https",
      } as any,
      "ws_abc",
      "linear",
      allowedOrigins
    )

    expect(url).toBe("/w/ws_abc?ws-settings=integrations&provider=linear")
  })

  test("falls back to a relative path with provider=linear when no forwarded headers are present", () => {
    const url = buildProviderCallbackRedirectUrl(
      {
        headers: {},
        protocol: "https",
      } as any,
      "ws_abc",
      "linear",
      allowedOrigins
    )

    expect(url).toBe("/w/ws_abc?ws-settings=integrations&provider=linear")
  })
})
