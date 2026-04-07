import { describe, expect, test } from "bun:test"
import { createGithubInstallState, decryptJson, encryptJson, verifyGithubInstallState } from "./crypto"

describe("workspace integration crypto helpers", () => {
  test("encrypts and decrypts JSON payloads", () => {
    const secret = "workspace-integration-secret"
    const payload = { installationId: 42, accessToken: "token_123", tokenExpiresAt: "2026-04-07T10:00:00.000Z" }

    const encrypted = encryptJson(secret, payload)
    expect(decryptJson<typeof payload>(secret, encrypted)).toEqual(payload)
  })

  test("signs and verifies GitHub installation state", () => {
    const secret = "workspace-integration-secret"
    const now = Date.UTC(2026, 3, 7, 12, 0, 0)
    const state = createGithubInstallState(secret, "ws_123", now)

    expect(verifyGithubInstallState(secret, state, now + 1_000)).toEqual({ workspaceId: "ws_123" })
  })

  test("rejects expired GitHub installation state", () => {
    const secret = "workspace-integration-secret"
    const now = Date.UTC(2026, 3, 7, 12, 0, 0)
    const state = createGithubInstallState(secret, "ws_123", now)

    expect(() => verifyGithubInstallState(secret, state, now + 60 * 60 * 1000 + 1)).toThrow(
      "GitHub install state has expired"
    )
  })
})
