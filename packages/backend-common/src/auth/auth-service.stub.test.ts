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

  test("encodes prompt into the stub login URL when provided", () => {
    const svc = new StubAuthService()
    const url = svc.getAuthorizationUrl("/redirect-here", "https://app.example.com/callback", {
      prompt: "login",
    })
    const params = new URLSearchParams(url.split("?")[1])

    expect(params.get("prompt")).toBe("login")
    expect(params.get("state")).toBe(Buffer.from("/redirect-here").toString("base64"))
    expect(params.get("redirect_uri")).toBe("https://app.example.com/callback")
  })
})
