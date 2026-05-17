import { describe, expect, test } from "bun:test"
import { StubAuthService } from "./auth-service.stub"

describe("StubAuthService.getAuthorizationUrl prompt plumbing", () => {
  test("omits prompt when no options are passed", () => {
    const svc = new StubAuthService()
    const url = svc.getAuthorizationUrl("/redirect-here", "https://app.example.com/callback")
    const params = new URLSearchParams(url.split("?")[1])

    expect(params.has("prompt")).toBe(false)
    expect(params.get("state")).toBe(Buffer.from("/redirect-here").toString("base64"))
    expect(params.get("redirect_uri")).toBe("https://app.example.com/callback")
  })

  test("encodes a space-delimited multi-value prompt into the stub login URL", () => {
    const svc = new StubAuthService()
    const url = svc.getAuthorizationUrl("/redirect-here", "https://app.example.com/callback", {
      prompt: "login select_account",
    })
    const params = new URLSearchParams(url.split("?")[1])

    // The add-account flow sends the OIDC space-delimited form; the space
    // must survive URL encoding and decode back intact.
    expect(params.get("prompt")).toBe("login select_account")
    expect(params.get("state")).toBe(Buffer.from("/redirect-here").toString("base64"))
    expect(params.get("redirect_uri")).toBe("https://app.example.com/callback")
  })
})
