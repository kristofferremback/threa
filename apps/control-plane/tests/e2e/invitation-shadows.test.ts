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

  describe("Login no longer auto-accepts", () => {
    test("stub login with pending shadows redirects to root", async () => {
      const client = new TestClient()
      const email = "no-auto-accept@example.com"

      // Create a shadow for this email
      await createShadow(client, {
        id: "inv_no_auto",
        workspaceId: "ws_no_auto",
        email,
        region: "local",
        expiresAt: futureDate,
      })

      // Login via stub — should redirect to root (no auto-acceptance)
      const loginRes = await client.post("/test-auth-login", { email, name: "No Auto" })
      expect(loginRes.status).toBe(302)
      expect(loginRes.headers.get("location")).toBe("/")
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

    test("revoked shadows are not listed as pending", async () => {
      const client = new TestClient()
      const email = "revoked-shadow@example.com"

      const owner = new TestClient()
      await loginAs(owner, "revoke-list-owner@example.com", "Revoke Owner")
      const ws = await createWorkspace(owner, "Revoke List WS")

      // Create and revoke a shadow
      await createShadow(client, {
        id: "inv_revoked_test",
        workspaceId: ws.id,
        email,
        region: "local",
        expiresAt: futureDate,
      })
      await client.internalRequest("PATCH", "/internal/invitation-shadows/inv_revoked_test", {
        status: "revoked",
      })

      // Login and check workspace list — no pending invitations
      await loginAs(client, email, "Revoked User")
      const res = await client.get<{ workspaces: unknown[]; pendingInvitations: unknown[] }>("/api/workspaces")
      expect(res.status).toBe(200)
      expect(res.data.pendingInvitations).toHaveLength(0)
    })

    test("expired shadows are not listed as pending", async () => {
      const client = new TestClient()
      const email = "expired-shadow@example.com"
      const pastDate = new Date(Date.now() - 1000).toISOString()

      const owner = new TestClient()
      await loginAs(owner, "expire-list-owner@example.com", "Expire Owner")
      const ws = await createWorkspace(owner, "Expire List WS")

      // Create an already-expired shadow
      await createShadow(client, {
        id: "inv_expired_test",
        workspaceId: ws.id,
        email,
        region: "local",
        expiresAt: pastDate,
      })

      // Login and check workspace list — no pending invitations
      await loginAs(client, email, "Expired User")
      const res = await client.get<{ workspaces: unknown[]; pendingInvitations: unknown[] }>("/api/workspaces")
      expect(res.status).toBe(200)
      expect(res.data.pendingInvitations).toHaveLength(0)
    })
  })

  describe("Explicit acceptance", () => {
    test("GET /api/workspaces returns pending invitations", async () => {
      const owner = new TestClient()
      await loginAs(owner, "pending-list-owner@example.com", "List Owner")
      const ws = await createWorkspace(owner, "Pending List WS")

      const invitee = new TestClient()
      const email = "pending-list@example.com"
      await createShadow(invitee, {
        id: "inv_pending_list",
        workspaceId: ws.id,
        email,
        region: "local",
        expiresAt: futureDate,
      })

      await loginAs(invitee, email, "Pending User")
      const res = await invitee.get<{
        workspaces: unknown[]
        pendingInvitations: Array<{ id: string; workspaceId: string; workspaceName: string }>
      }>("/api/workspaces")
      expect(res.status).toBe(200)
      expect(res.data.pendingInvitations).toHaveLength(1)
      expect(res.data.pendingInvitations[0].id).toBe("inv_pending_list")
      expect(res.data.pendingInvitations[0].workspaceId).toBe(ws.id)
      expect(res.data.pendingInvitations[0].workspaceName).toBe("Pending List WS")
    })

    test("POST /api/invitations/:id/accept accepts a pending shadow", async () => {
      const owner = new TestClient()
      await loginAs(owner, "accept-owner@example.com", "Accept Owner")
      const ws = await createWorkspace(owner, "Accept WS")

      const invitee = new TestClient()
      const email = "accept-user@example.com"
      await createShadow(invitee, {
        id: "inv_accept_explicit",
        workspaceId: ws.id,
        email,
        region: "local",
        expiresAt: futureDate,
      })

      await loginAs(invitee, email, "Accept User")
      const acceptRes = await invitee.post<{ workspaceId: string }>("/api/invitations/inv_accept_explicit/accept")
      expect(acceptRes.status).toBe(200)
      expect(acceptRes.data.workspaceId).toBe(ws.id)

      // Workspace should now appear in list, invitation should be gone
      const listRes = await invitee.get<{
        workspaces: Array<{ id: string }>
        pendingInvitations: unknown[]
      }>("/api/workspaces")
      expect(listRes.status).toBe(200)
      expect(listRes.data.workspaces.some((w) => w.id === ws.id)).toBe(true)
      expect(listRes.data.pendingInvitations).toHaveLength(0)
    })

    test("POST /api/invitations/:id/accept returns 404 for nonexistent shadow", async () => {
      const client = new TestClient()
      await loginAs(client, "accept-404@example.com", "Accept 404")
      const res = await client.post("/api/invitations/inv_nonexistent/accept")
      expect(res.status).toBe(404)
    })

    test("POST /api/invitations/:id/accept returns 401 without auth", async () => {
      const client = new TestClient()
      const res = await client.post("/api/invitations/inv_some/accept")
      expect(res.status).toBe(401)
    })
  })

  describe("Idempotency and replay safety", () => {
    test("second accept of same shadow returns 404", async () => {
      const owner = new TestClient()
      await loginAs(owner, "idem-owner@example.com", "Idem Owner")
      const ws = await createWorkspace(owner, "Idem Workspace")

      const invitee = new TestClient()
      const email = "idempotent-accept@example.com"
      await createShadow(invitee, {
        id: "inv_idempotent",
        workspaceId: ws.id,
        email,
        region: "local",
        expiresAt: futureDate,
      })

      await loginAs(invitee, email, "Idem User")

      // First accept — succeeds
      const accept1 = await invitee.post<{ workspaceId: string }>("/api/invitations/inv_idempotent/accept")
      expect(accept1.status).toBe(200)
      expect(accept1.data.workspaceId).toBe(ws.id)

      // Second accept — shadow is no longer pending
      const accept2 = await invitee.post("/api/invitations/inv_idempotent/accept")
      expect(accept2.status).toBe(404)
    })

    test("accepted shadow creates membership that persists across logins", async () => {
      const owner = new TestClient()
      await loginAs(owner, "persist-owner@example.com", "Persist Owner")
      const ws = await createWorkspace(owner, "Persist Workspace")

      const invitee = new TestClient()
      const email = "persist-member@example.com"
      await createShadow(invitee, {
        id: "inv_persist",
        workspaceId: ws.id,
        email,
        region: "local",
        expiresAt: futureDate,
      })

      await loginAs(invitee, email, "Persist User")
      await invitee.post("/api/invitations/inv_persist/accept")

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

    test("multiple shadows for same user accepted individually", async () => {
      const owner = new TestClient()
      await loginAs(owner, "multi-owner@example.com", "Multi Owner")
      const ws1 = await createWorkspace(owner, "Multi WS 1")
      const ws2 = await createWorkspace(owner, "Multi WS 2")

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

      await loginAs(invitee, email, "Multi User")

      // Should see both pending invitations
      const listRes = await invitee.get<{
        pendingInvitations: Array<{ id: string }>
      }>("/api/workspaces")
      expect(listRes.data.pendingInvitations).toHaveLength(2)

      // Accept both individually
      await invitee.post("/api/invitations/inv_multi_1/accept")
      await invitee.post("/api/invitations/inv_multi_2/accept")

      // Both workspaces should appear in the list
      const res = await invitee.get<{ workspaces: Array<{ id: string }>; pendingInvitations: unknown[] }>(
        "/api/workspaces"
      )
      expect(res.status).toBe(200)
      const ids = res.data.workspaces.map((w) => w.id)
      expect(ids).toContain(ws1.id)
      expect(ids).toContain(ws2.id)
      expect(res.data.pendingInvitations).toHaveLength(0)
    })

    test("revoking shadow after it was accepted has no effect on membership", async () => {
      const owner = new TestClient()
      await loginAs(owner, "revoke-after-owner@example.com", "Revoke Owner")
      const ws = await createWorkspace(owner, "Revoke After WS")

      const invitee = new TestClient()
      const email = "revoke-after@example.com"
      await createShadow(invitee, {
        id: "inv_revoke_after",
        workspaceId: ws.id,
        email,
        region: "local",
        expiresAt: futureDate,
      })

      await loginAs(invitee, email, "Revoke After")
      await invitee.post("/api/invitations/inv_revoke_after/accept")

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
