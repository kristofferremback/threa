import { describe, test, expect } from "bun:test"
import { Pool } from "pg"
import { TestClient, loginAs, createWorkspace } from "../client"
import { PlatformRoleRepository } from "../../src/features/backoffice"

/**
 * Opens a short-lived pool to seed a platform-admin row directly. Tests run in
 * the same process as the control-plane (see setup.ts), so going through the
 * repository is the most direct way to grant admin without a dedicated
 * internal API for it.
 */
async function grantAdmin(workosUserId: string): Promise<void> {
  const pool = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL || "postgresql://threa:threa@localhost:5454/threa_control_plane_test",
  })
  try {
    await PlatformRoleRepository.upsert(pool, workosUserId, "admin")
  } finally {
    await pool.end()
  }
}

describe("Backoffice", () => {
  describe("GET /api/backoffice/me", () => {
    test("returns 401 without session", async () => {
      const client = new TestClient()
      const res = await client.get("/api/backoffice/me")
      expect(res.status).toBe(401)
    })

    test("returns user with isPlatformAdmin=false for non-admin", async () => {
      const client = new TestClient()
      await loginAs(client, "backoffice-nonadmin@example.com", "Non Admin")

      const res = await client.get<{
        id: string
        email: string
        name: string
        isPlatformAdmin: boolean
      }>("/api/backoffice/me")

      expect(res.status).toBe(200)
      expect(res.data.email).toBe("backoffice-nonadmin@example.com")
      expect(res.data.isPlatformAdmin).toBe(false)
    })

    test("returns user with isPlatformAdmin=true for admin", async () => {
      const client = new TestClient()
      const user = await loginAs(client, "backoffice-admin@example.com", "Platform Admin")
      await grantAdmin(user.id)

      const res = await client.get<{ isPlatformAdmin: boolean; email: string }>("/api/backoffice/me")
      expect(res.status).toBe(200)
      expect(res.data.email).toBe("backoffice-admin@example.com")
      expect(res.data.isPlatformAdmin).toBe(true)
    })
  })

  describe("POST /api/backoffice/workspace-owner-invitations", () => {
    test("returns 401 without session", async () => {
      const client = new TestClient()
      const res = await client.post("/api/backoffice/workspace-owner-invitations", {
        email: "new-owner@example.com",
      })
      expect(res.status).toBe(401)
    })

    test("returns 403 when authenticated but not a platform admin", async () => {
      const client = new TestClient()
      await loginAs(client, "invite-nonadmin@example.com", "Not Admin")

      const res = await client.post<{ code: string }>("/api/backoffice/workspace-owner-invitations", {
        email: "would-be-owner@example.com",
      })
      expect(res.status).toBe(403)
      expect(res.data.code).toBe("NOT_PLATFORM_ADMIN")
    })

    test("returns 400 for invalid email", async () => {
      const client = new TestClient()
      const user = await loginAs(client, "invite-admin-bad@example.com", "Admin Bad Email")
      await grantAdmin(user.id)

      const res = await client.post<{ code: string }>("/api/backoffice/workspace-owner-invitations", {
        email: "not-an-email",
      })
      expect(res.status).toBe(400)
      expect(res.data.code).toBe("VALIDATION_ERROR")
    })

    test("creates an invitation when called by a platform admin", async () => {
      const client = new TestClient()
      const user = await loginAs(client, "invite-admin@example.com", "Inviter Admin")
      await grantAdmin(user.id)

      const res = await client.post<{
        invitation: { id: string; email: string; expiresAt: string }
      }>("/api/backoffice/workspace-owner-invitations", {
        email: "brand-new-owner@example.com",
      })

      expect(res.status).toBe(201)
      expect(res.data.invitation.email).toBe("brand-new-owner@example.com")
      expect(res.data.invitation.id).toBeTruthy()
      expect(() => new Date(res.data.invitation.expiresAt).toISOString()).not.toThrow()
    })
  })

  describe("GET /api/backoffice/workspace-owner-invitations", () => {
    test("returns 403 when authenticated but not a platform admin", async () => {
      const client = new TestClient()
      await loginAs(client, "invites-list-nonadmin@example.com", "List Non Admin")

      const res = await client.get<{ code: string }>("/api/backoffice/workspace-owner-invitations")
      expect(res.status).toBe(403)
      expect(res.data.code).toBe("NOT_PLATFORM_ADMIN")
    })

    test("lists previously sent invitations for a platform admin", async () => {
      const client = new TestClient()
      const user = await loginAs(client, "invites-list-admin@example.com", "List Admin")
      await grantAdmin(user.id)

      const postRes = await client.post<{
        invitation: { id: string; email: string }
      }>("/api/backoffice/workspace-owner-invitations", {
        email: "list-seed@example.com",
      })
      expect(postRes.status).toBe(201)

      const listRes = await client.get<{
        invitations: Array<{ id: string; email: string; state: string }>
      }>("/api/backoffice/workspace-owner-invitations")

      expect(listRes.status).toBe(200)
      const found = listRes.data.invitations.find((i) => i.id === postRes.data.invitation.id)
      expect(found).toBeTruthy()
      expect(found?.email).toBe("list-seed@example.com")
      expect(found?.state).toBe("pending")
    })
  })

  describe("GET /api/backoffice/workspaces", () => {
    test("returns 403 when authenticated but not a platform admin", async () => {
      const client = new TestClient()
      await loginAs(client, "workspaces-list-nonadmin@example.com", "Workspaces Non Admin")

      const res = await client.get<{ code: string }>("/api/backoffice/workspaces")
      expect(res.status).toBe(403)
      expect(res.data.code).toBe("NOT_PLATFORM_ADMIN")
    })

    test("returns an array for a platform admin", async () => {
      const client = new TestClient()
      const user = await loginAs(client, "workspaces-list-admin@example.com", "Workspaces Admin")
      await grantAdmin(user.id)

      const res = await client.get<{
        workspaces: Array<{ id: string; name: string; slug: string; region: string; memberCount: number }>
      }>("/api/backoffice/workspaces")

      expect(res.status).toBe(200)
      expect(Array.isArray(res.data.workspaces)).toBe(true)
    })
  })

  describe("GET /api/backoffice/workspaces/:id/members", () => {
    test("returns 401 without session", async () => {
      const client = new TestClient()
      const res = await client.get("/api/backoffice/workspaces/ws_anything/members")
      expect(res.status).toBe(401)
    })

    test("returns 403 when authenticated but not a platform admin", async () => {
      const client = new TestClient()
      await loginAs(client, "members-nonadmin@example.com", "Members Non Admin")

      const res = await client.get<{ code: string }>("/api/backoffice/workspaces/ws_anything/members")
      expect(res.status).toBe(403)
      expect(res.data.code).toBe("NOT_PLATFORM_ADMIN")
    })

    test("returns 404 when workspace does not exist", async () => {
      const client = new TestClient()
      const user = await loginAs(client, "members-admin-404@example.com", "Members Admin 404")
      await grantAdmin(user.id)

      const res = await client.get<{ code: string }>("/api/backoffice/workspaces/ws_does_not_exist/members")
      expect(res.status).toBe(404)
      expect(res.data.code).toBe("NOT_FOUND")
    })

    test("returns members array (mirror-shaped) for an admin and existing workspace", async () => {
      const client = new TestClient()
      const user = await loginAs(client, "members-admin@example.com", "Members Admin")
      await grantAdmin(user.id)

      // Stub auth provisions a WorkOS organization on workspace creation, but
      // the mirror is empty until backfill or events run. The route should
      // still return an empty array, not 404.
      const ws = await createWorkspace(client, "Members Test")
      const res = await client.get<{
        members: Array<{
          workosUserId: string
          email: string | null
          firstName: string | null
          lastName: string | null
          status: string
          roleSlugs: string[]
          lastEventAt: string
        }>
      }>(`/api/backoffice/workspaces/${ws.id}/members`)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.data.members)).toBe(true)
    })
  })

  describe("Idempotency", () => {
    test("granting admin twice leaves the user as admin", async () => {
      const client = new TestClient()
      const user = await loginAs(client, "idem-admin@example.com", "Idem Admin")

      await grantAdmin(user.id)
      await grantAdmin(user.id)

      const res = await client.get<{ isPlatformAdmin: boolean }>("/api/backoffice/me")
      expect(res.status).toBe(200)
      expect(res.data.isPlatformAdmin).toBe(true)
    })
  })
})
