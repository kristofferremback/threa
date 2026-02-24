import { describe, test, expect } from "bun:test"
import { TestClient, loginAs, createShadow, createWorkspace } from "../client"

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

  describe("Idempotency and replay safety", () => {
    test("second login does not re-accept already accepted shadow", async () => {
      // Owner creates workspace
      const owner = new TestClient()
      await loginAs(owner, "idem-owner@example.com", "Idem Owner")
      const ws = await createWorkspace(owner, "Idem Workspace")

      // Create shadow for invitee
      const invitee = new TestClient()
      const email = "idempotent-accept@example.com"
      await createShadow(invitee, {
        id: "inv_idempotent",
        workspaceId: ws.id,
        email,
        region: "local",
        expiresAt: futureDate,
      })

      // First login — accepts shadow, redirects to workspace setup
      const login1 = await invitee.post("/test-auth-login", { email, name: "Idem User" })
      expect(login1.status).toBe(302)
      expect(login1.headers.get("location")).toContain(`/w/${ws.id}/setup`)

      // Second login — shadow is already accepted, no pending shadows left
      const login2 = await invitee.post("/test-auth-login", { email, name: "Idem User" })
      expect(login2.status).toBe(302)
      // Should redirect to root (not to workspace setup, since no NEW acceptances)
      expect(login2.headers.get("location")).toBe("/")
    })

    test("accepted shadow creates membership that persists across logins", async () => {
      // Owner creates workspace
      const owner = new TestClient()
      await loginAs(owner, "persist-owner@example.com", "Persist Owner")
      const ws = await createWorkspace(owner, "Persist Workspace")

      // Create shadow and login as invitee
      const invitee = new TestClient()
      const email = "persist-member@example.com"
      await createShadow(invitee, {
        id: "inv_persist",
        workspaceId: ws.id,
        email,
        region: "local",
        expiresAt: futureDate,
      })
      await invitee.post("/test-auth-login", { email, name: "Persist User" })

      // Check workspace list — should include the accepted workspace
      const res1 = await invitee.get<{ workspaces: Array<{ id: string }> }>("/api/workspaces")
      expect(res1.status).toBe(200)
      expect(res1.data.workspaces.some((w) => w.id === ws.id)).toBe(true)

      // Login again — membership should still be there
      await invitee.post("/api/dev/login", { email, name: "Persist User" })
      const res2 = await invitee.get<{ workspaces: Array<{ id: string }> }>("/api/workspaces")
      expect(res2.status).toBe(200)
      expect(res2.data.workspaces.some((w) => w.id === ws.id)).toBe(true)
    })

    test("multiple shadows for same user accepted in single login", async () => {
      // Owner creates two workspaces
      const owner = new TestClient()
      await loginAs(owner, "multi-owner@example.com", "Multi Owner")
      const ws1 = await createWorkspace(owner, "Multi WS 1")
      const ws2 = await createWorkspace(owner, "Multi WS 2")

      // Create shadows for invitee pointing to both workspaces
      const invitee = new TestClient()
      const email = "multi-shadow@example.com"
      await createShadow(invitee, {
        id: "inv_multi_1",
        workspaceId: ws1.id,
        email,
        region: "local",
        expiresAt: futureDate,
      })
      await createShadow(invitee, {
        id: "inv_multi_2",
        workspaceId: ws2.id,
        email,
        region: "local",
        expiresAt: futureDate,
      })

      // Login — should accept both shadows (>1 accepted → redirect to root, not setup)
      const loginRes = await invitee.post("/test-auth-login", { email, name: "Multi User" })
      expect(loginRes.status).toBe(302)
      expect(loginRes.headers.get("location")).toBe("/")

      // Both workspaces should appear in the list
      const res = await invitee.get<{ workspaces: Array<{ id: string }> }>("/api/workspaces")
      expect(res.status).toBe(200)
      const ids = res.data.workspaces.map((w) => w.id)
      expect(ids).toContain(ws1.id)
      expect(ids).toContain(ws2.id)
    })

    test("revoking shadow after it was accepted has no effect on membership", async () => {
      // Owner creates workspace
      const owner = new TestClient()
      await loginAs(owner, "revoke-after-owner@example.com", "Revoke Owner")
      const ws = await createWorkspace(owner, "Revoke After WS")

      // Create shadow and login as invitee
      const invitee = new TestClient()
      const email = "revoke-after@example.com"
      await createShadow(invitee, {
        id: "inv_revoke_after",
        workspaceId: ws.id,
        email,
        region: "local",
        expiresAt: futureDate,
      })
      await invitee.post("/test-auth-login", { email, name: "Revoke After" })

      // Try to revoke the already-accepted shadow
      const revokeRes = await invitee.internalRequest("PATCH", "/internal/invitation-shadows/inv_revoke_after", {
        status: "revoked",
      })
      // Should return 404 — shadow is no longer in 'pending' state
      expect(revokeRes.status).toBe(404)

      // Workspace membership should still exist
      const wsRes = await invitee.get<{ workspaces: Array<{ id: string }> }>("/api/workspaces")
      expect(wsRes.status).toBe(200)
      expect(wsRes.data.workspaces.some((w) => w.id === ws.id)).toBe(true)
    })
  })
})
