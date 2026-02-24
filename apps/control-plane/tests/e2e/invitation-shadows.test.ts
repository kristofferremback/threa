import { describe, test, expect } from "bun:test"
import { TestClient, loginAs, createShadow } from "../client"

describe("Invitation Shadows", () => {
  const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  describe("Internal API", () => {
    test("POST /internal/invitation-shadows creates a shadow", async () => {
      const client = new TestClient()
      const res = await client.internalRequest("POST", "/internal/invitation-shadows", {
        id: "inv_test_create",
        workspaceId: "ws_test_1",
        email: "shadow@example.com",
        region: "local",
        expiresAt: futureDate,
      })
      expect(res.status).toBe(201)
    })

    test("POST /internal/invitation-shadows returns 401 without API key", async () => {
      const client = new TestClient()
      const res = await client.post("/internal/invitation-shadows", {
        id: "inv_no_auth",
        workspaceId: "ws_test_1",
        email: "noauth@example.com",
        region: "local",
        expiresAt: futureDate,
      })
      expect(res.status).toBe(401)
    })

    test("POST /internal/invitation-shadows returns 400 for invalid body", async () => {
      const client = new TestClient()
      const res = await client.internalRequest("POST", "/internal/invitation-shadows", {
        id: "inv_bad",
        // Missing required fields
      })
      expect(res.status).toBe(400)
    })

    test("PATCH /internal/invitation-shadows/:id revokes a shadow", async () => {
      const client = new TestClient()

      // Create first
      await createShadow(client, {
        id: "inv_to_revoke",
        workspaceId: "ws_test_revoke",
        email: "revoke@example.com",
        region: "local",
        expiresAt: futureDate,
      })

      // Revoke
      const res = await client.internalRequest("PATCH", "/internal/invitation-shadows/inv_to_revoke", {
        status: "revoked",
      })
      expect(res.status).toBe(200)
    })

    test("PATCH /internal/invitation-shadows/:id returns 404 for nonexistent shadow", async () => {
      const client = new TestClient()
      const res = await client.internalRequest("PATCH", "/internal/invitation-shadows/inv_nonexistent", {
        status: "revoked",
      })
      expect(res.status).toBe(404)
    })

    test("PATCH /internal/invitation-shadows/:id returns 401 without API key", async () => {
      const client = new TestClient()
      const res = await client.patch("/internal/invitation-shadows/inv_test", { status: "revoked" })
      expect(res.status).toBe(401)
    })
  })

  describe("Auto-acceptance on login", () => {
    test("stub login auto-accepts pending shadows", async () => {
      const client = new TestClient()
      const email = "auto-accept@example.com"

      // Create a shadow for this email (simulating backend invitation sync)
      await createShadow(client, {
        id: "inv_auto_accept",
        workspaceId: "ws_auto_accept",
        email,
        region: "local",
        expiresAt: futureDate,
      })

      // Login via stub — should auto-accept the shadow
      const loginRes = await client.post("/test-auth-login", { email, name: "Auto Accepter" })

      // Should redirect to workspace setup (exactly 1 accepted workspace)
      expect(loginRes.status).toBe(302)
      const location = loginRes.headers.get("location")
      expect(location).toContain("/w/ws_auto_accept/setup")
    })

    test("stub login with no pending shadows redirects to root", async () => {
      const client = new TestClient()
      const loginRes = await client.post("/test-auth-login", {
        email: "no-shadows@example.com",
        name: "No Shadows",
      })

      expect(loginRes.status).toBe(302)
      expect(loginRes.headers.get("location")).toBe("/")
    })

    test("revoked shadows are not accepted on login", async () => {
      const client = new TestClient()
      const email = "revoked-shadow@example.com"

      // Create and revoke a shadow
      await createShadow(client, {
        id: "inv_revoked_test",
        workspaceId: "ws_revoked",
        email,
        region: "local",
        expiresAt: futureDate,
      })
      await client.internalRequest("PATCH", "/internal/invitation-shadows/inv_revoked_test", {
        status: "revoked",
      })

      // Login — should NOT redirect to workspace setup
      const loginRes = await client.post("/test-auth-login", { email, name: "Revoked User" })
      expect(loginRes.status).toBe(302)
      expect(loginRes.headers.get("location")).toBe("/")
    })

    test("expired shadows are not accepted on login", async () => {
      const client = new TestClient()
      const email = "expired-shadow@example.com"
      const pastDate = new Date(Date.now() - 1000).toISOString()

      // Create an already-expired shadow
      await createShadow(client, {
        id: "inv_expired_test",
        workspaceId: "ws_expired",
        email,
        region: "local",
        expiresAt: pastDate,
      })

      // Login — should NOT redirect to workspace setup
      const loginRes = await client.post("/test-auth-login", { email, name: "Expired User" })
      expect(loginRes.status).toBe(302)
      expect(loginRes.headers.get("location")).toBe("/")
    })
  })
})
