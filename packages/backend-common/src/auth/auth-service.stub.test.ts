import { describe, expect, test } from "bun:test"
import { StubAuthService } from "./auth-service.stub"

describe("StubAuthService.getAuthorizationUrl provider plumbing", () => {
  test("omits provider when no options are passed", () => {
    const svc = new StubAuthService()
    const url = svc.getAuthorizationUrl("/redirect-here", "https://app.example.com/callback")
    const params = new URLSearchParams(url.split("?")[1])

    expect(params.has("provider")).toBe(false)
    expect(params.get("state")).toBe(Buffer.from("/redirect-here").toString("base64"))
    expect(params.get("redirect_uri")).toBe("https://app.example.com/callback")
  })

  test("passes the social provider through to the stub login URL", () => {
    const svc = new StubAuthService()
    const url = svc.getAuthorizationUrl("/redirect-here", "https://app.example.com/callback", {
      provider: "GoogleOAuth",
    })
    const params = new URLSearchParams(url.split("?")[1])

    // The add-account picker emits `provider=GoogleOAuth` to bypass AuthKit.
    // The stub echoes it back so tests can prove it survived plumbing.
    expect(params.get("provider")).toBe("GoogleOAuth")
    expect(params.get("state")).toBe(Buffer.from("/redirect-here").toString("base64"))
    expect(params.get("redirect_uri")).toBe("https://app.example.com/callback")
  })
})

describe("StubAuthService magic auth", () => {
  test("sendMagicAuthCode + authenticateWithMagicAuth round-trips", async () => {
    const svc = new StubAuthService()
    const email = "magic-test@example.com"

    const send = await svc.sendMagicAuthCode(email)
    expect(send).toEqual({ ok: true })

    // Wrong code rejects without consuming — the user can retry.
    const wrong = await svc.authenticateWithMagicAuth(email, "000000")
    expect(wrong.success).toBe(false)

    const right = await svc.authenticateWithMagicAuth(email, "123456")
    expect(right.success).toBe(true)
    expect(right.sealedSession).toMatch(/^test_session_workos_test_/)
    expect(right.user?.email).toBe(email)
  })

  test("authenticateWithMagicAuth consumes the code (single use)", async () => {
    const svc = new StubAuthService()
    const email = "once@example.com"

    await svc.sendMagicAuthCode(email)
    const first = await svc.authenticateWithMagicAuth(email, "123456")
    expect(first.success).toBe(true)

    const second = await svc.authenticateWithMagicAuth(email, "123456")
    expect(second.success).toBe(false)
  })
})
