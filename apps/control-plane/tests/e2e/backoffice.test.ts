import { describe, test, expect } from "bun:test"
import { Pool } from "pg"
import { TestClient, loginAs } from "../client"
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
