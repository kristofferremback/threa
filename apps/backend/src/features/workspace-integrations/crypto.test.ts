import { createCipheriv, createHmac, randomBytes } from "crypto"
import { describe, expect, test } from "bun:test"
import { WorkspaceIntegrationProviders, type WorkspaceIntegrationProvider } from "@threa/types"
import { createGithubInstallState, decryptJson, encryptJson, verifyGithubInstallState } from "./crypto"

describe("workspace integration crypto helpers", () => {
  test("encrypts and decrypts JSON payloads", () => {
    const secret = "workspace-integration-secret"
    const payload = { installationId: 42, accessToken: "token_123", tokenExpiresAt: "2026-04-07T10:00:00.000Z" }

    const encrypted = encryptJson(secret, payload, {
      workspaceId: "ws_123",
      provider: WorkspaceIntegrationProviders.GITHUB,
    })
    expect(
      decryptJson<typeof payload>(secret, encrypted, {
        workspaceId: "ws_123",
        provider: WorkspaceIntegrationProviders.GITHUB,
      })
    ).toEqual(payload)
  })

  test("rejects decrypting with the wrong workspace context", () => {
    const secret = "workspace-integration-secret"
    const payload = { installationId: 42, accessToken: "token_123", tokenExpiresAt: "2026-04-07T10:00:00.000Z" }
    const encrypted = encryptJson(secret, payload, {
      workspaceId: "ws_123",
      provider: WorkspaceIntegrationProviders.GITHUB,
    })

    expect(() =>
      decryptJson<typeof payload>(secret, encrypted, {
        workspaceId: "ws_456",
        provider: WorkspaceIntegrationProviders.GITHUB,
      })
    ).toThrow()
  })

  test("rejects decrypting with the wrong provider context", () => {
    const secret = "workspace-integration-secret"
    const payload = { installationId: 42, accessToken: "token_123", tokenExpiresAt: "2026-04-07T10:00:00.000Z" }
    const encrypted = encryptJson(secret, payload, {
      workspaceId: "ws_123",
      provider: WorkspaceIntegrationProviders.GITHUB,
    })

    expect(() =>
      decryptJson<typeof payload>(secret, encrypted, {
        workspaceId: "ws_123",
        provider: "linear" as WorkspaceIntegrationProvider,
      })
    ).toThrow()
  })

  test("rejects legacy payloads without workspace context binding", () => {
    const secret = "workspace-integration-secret"
    const payload = { installationId: 42, accessToken: "token_123", tokenExpiresAt: "2026-04-07T10:00:00.000Z" }
    const encrypted = createLegacyEncryptedPayload(secret, payload)

    expect(() =>
      decryptJson<typeof payload>(secret, encrypted, {
        workspaceId: "ws_123",
        provider: WorkspaceIntegrationProviders.GITHUB,
      })
    ).toThrow("Invalid encrypted workspace integration payload")
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

function createLegacyEncryptedPayload(secret: string, value: unknown) {
  const iv = randomBytes(12)
  const key = createHmac("sha256", secret).update("workspace-integration-credentials:v1").digest()
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const plaintext = Buffer.from(JSON.stringify(value), "utf8")
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    v: 1,
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  }
}
