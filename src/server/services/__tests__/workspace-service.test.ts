import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { Pool } from "pg"
import { WorkspaceService } from "../workspace-service"
import {
  getTestPool,
  closeTestPool,
  cleanupTestData,
  createTestUser,
  createTestWorkspace,
  addUserToWorkspace,
} from "./test-helpers"
import { sql } from "../../lib/db"

describe("WorkspaceService", () => {
  let pool: Pool
  let workspaceService: WorkspaceService

  beforeAll(async () => {
    pool = await getTestPool()
    workspaceService = new WorkspaceService(pool)
  })

  afterAll(async () => {
    await closeTestPool()
  })

  beforeEach(async () => {
    await cleanupTestData(pool)
  })

  describe("createWorkspace", () => {
    test("should create a workspace with default settings", async () => {
      const user = await createTestUser(pool)

      const workspace = await workspaceService.createWorkspace("Test Workspace", user.id)

      expect(workspace.id).toBeDefined()
      expect(workspace.name).toBe("Test Workspace")
      expect(workspace.slug).toContain("test-workspace")
      expect(workspace.plan_tier).toBe("free")
      expect(workspace.seat_limit).toBe(5)
    })

    test("should generate unique slugs", async () => {
      const user = await createTestUser(pool)

      const ws1 = await workspaceService.createWorkspace("Test", user.id)
      const ws2 = await workspaceService.createWorkspace("Test", user.id)

      expect(ws1.slug).not.toBe(ws2.slug)
    })
  })

  describe("getWorkspace", () => {
    test("should return workspace by id", async () => {
      const user = await createTestUser(pool)
      const created = await workspaceService.createWorkspace("My Workspace", user.id)

      const fetched = await workspaceService.getWorkspace(created.id)

      expect(fetched).not.toBeNull()
      expect(fetched?.id).toBe(created.id)
      expect(fetched?.name).toBe("My Workspace")
    })

    test("should return null for non-existent workspace", async () => {
      const fetched = await workspaceService.getWorkspace("non-existent-id")
      expect(fetched).toBeNull()
    })
  })

  describe("ensureWorkspaceMember", () => {
    test("should add new member to workspace", async () => {
      const workspace = await createTestWorkspace(pool)
      const user = await createTestUser(pool)

      await workspaceService.ensureWorkspaceMember(workspace.id, user.id, "member")

      const result = await pool.query(
        sql`SELECT role, status FROM workspace_members WHERE workspace_id = ${workspace.id} AND user_id = ${user.id}`,
      )

      expect(result.rows[0].role).toBe("member")
      expect(result.rows[0].status).toBe("active")
    })

    test("should update role for existing member", async () => {
      const workspace = await createTestWorkspace(pool)
      const user = await createTestUser(pool)

      await workspaceService.ensureWorkspaceMember(workspace.id, user.id, "member")
      await workspaceService.ensureWorkspaceMember(workspace.id, user.id, "admin")

      const result = await pool.query(
        sql`SELECT role FROM workspace_members WHERE workspace_id = ${workspace.id} AND user_id = ${user.id}`,
      )

      expect(result.rows[0].role).toBe("admin")
    })

    test("should enforce seat limit", async () => {
      const workspace = await createTestWorkspace(pool)
      // Set a low seat limit
      await pool.query(sql`UPDATE workspaces SET seat_limit = 2 WHERE id = ${workspace.id}`)

      const user1 = await createTestUser(pool)
      const user2 = await createTestUser(pool)
      const user3 = await createTestUser(pool)

      await workspaceService.ensureWorkspaceMember(workspace.id, user1.id)
      await workspaceService.ensureWorkspaceMember(workspace.id, user2.id)

      await expect(workspaceService.ensureWorkspaceMember(workspace.id, user3.id)).rejects.toThrow("seat limit")
    })
  })

  describe("getOrCreateDefaultChannel", () => {
    test("should create general channel if not exists", async () => {
      const workspace = await createTestWorkspace(pool)

      const streamId = await workspaceService.getOrCreateDefaultChannel(workspace.id)

      expect(streamId).toBeDefined()

      const result = await pool.query(
        sql`SELECT name, slug, visibility FROM streams WHERE id = ${streamId}`,
      )

      expect(result.rows[0].name).toBe("general")
      expect(result.rows[0].slug).toBe("general")
      expect(result.rows[0].visibility).toBe("public")
    })

    test("should return existing general channel", async () => {
      const workspace = await createTestWorkspace(pool)

      const firstId = await workspaceService.getOrCreateDefaultChannel(workspace.id)
      const secondId = await workspaceService.getOrCreateDefaultChannel(workspace.id)

      expect(firstId).toBe(secondId)
    })
  })

  describe("Invitations", () => {
    test("should create invitation", async () => {
      const workspace = await createTestWorkspace(pool)
      const inviter = await createTestUser(pool, { email: "inviter@test.com" })
      await addUserToWorkspace(pool, inviter.id, workspace.id)

      const invitation = await workspaceService.createInvitation(
        workspace.id,
        "newuser@test.com",
        inviter.id,
        "member",
      )

      expect(invitation.id).toBeDefined()
      expect(invitation.token).toBeDefined()
      expect(invitation.expiresAt).toBeInstanceOf(Date)
    })

    test("should get invitation by token", async () => {
      const workspace = await createTestWorkspace(pool)
      const inviter = await createTestUser(pool, { email: "inviter@test.com" })
      await addUserToWorkspace(pool, inviter.id, workspace.id)

      const created = await workspaceService.createInvitation(
        workspace.id,
        "newuser@test.com",
        inviter.id,
      )

      const fetched = await workspaceService.getInvitationByToken(created.token)

      expect(fetched).not.toBeNull()
      expect(fetched?.id).toBe(created.id)
      expect(fetched?.email).toBe("newuser@test.com")
      expect(fetched?.workspaceId).toBe(workspace.id)
      expect(fetched?.status).toBe("pending")
    })

    test("should accept invitation", async () => {
      const workspace = await createTestWorkspace(pool)
      const inviter = await createTestUser(pool, { email: "inviter@test.com" })
      await addUserToWorkspace(pool, inviter.id, workspace.id)

      // Create default channel
      await workspaceService.getOrCreateDefaultChannel(workspace.id)

      const invitation = await workspaceService.createInvitation(
        workspace.id,
        "newuser@test.com",
        inviter.id,
      )

      // Create the new user
      const newUser = await createTestUser(pool, { email: "newuser@test.com" })

      const result = await workspaceService.acceptInvitation(
        invitation.token,
        newUser.id,
        "newuser@test.com",
        "New",
        "User",
      )

      expect(result.workspaceId).toBe(workspace.id)

      // Verify user is now a member
      const memberResult = await pool.query(
        sql`SELECT status FROM workspace_members WHERE workspace_id = ${workspace.id} AND user_id = ${newUser.id}`,
      )
      expect(memberResult.rows[0].status).toBe("active")

      // Verify invitation is marked as accepted
      const inviteResult = await pool.query(
        sql`SELECT status FROM workspace_invitations WHERE id = ${invitation.id}`,
      )
      expect(inviteResult.rows[0].status).toBe("accepted")
    })

    test("should reject invitation with wrong email", async () => {
      const workspace = await createTestWorkspace(pool)
      const inviter = await createTestUser(pool, { email: "inviter@test.com" })
      await addUserToWorkspace(pool, inviter.id, workspace.id)

      const invitation = await workspaceService.createInvitation(
        workspace.id,
        "correct@test.com",
        inviter.id,
      )

      const wrongUser = await createTestUser(pool, { email: "wrong@test.com" })

      await expect(
        workspaceService.acceptInvitation(
          invitation.token,
          wrongUser.id,
          "wrong@test.com",
        ),
      ).rejects.toThrow("different email")
    })

    test("should revoke invitation", async () => {
      const workspace = await createTestWorkspace(pool)
      const inviter = await createTestUser(pool, { email: "inviter@test.com" })
      await addUserToWorkspace(pool, inviter.id, workspace.id)

      const invitation = await workspaceService.createInvitation(
        workspace.id,
        "newuser@test.com",
        inviter.id,
      )

      await workspaceService.revokeInvitation(invitation.id, inviter.id)

      const result = await pool.query(
        sql`SELECT status FROM workspace_invitations WHERE id = ${invitation.id}`,
      )
      expect(result.rows[0].status).toBe("revoked")
    })

    test("should list pending invitations", async () => {
      const workspace = await createTestWorkspace(pool)
      const inviter = await createTestUser(pool, { email: "inviter@test.com" })
      await addUserToWorkspace(pool, inviter.id, workspace.id)

      await workspaceService.createInvitation(workspace.id, "user1@test.com", inviter.id)
      await workspaceService.createInvitation(workspace.id, "user2@test.com", inviter.id)

      const pending = await workspaceService.getPendingInvitations(workspace.id)

      expect(pending.length).toBe(2)
      expect(pending.some((i) => i.email === "user1@test.com")).toBe(true)
      expect(pending.some((i) => i.email === "user2@test.com")).toBe(true)
    })

    test("should not allow duplicate pending invitations", async () => {
      const workspace = await createTestWorkspace(pool)
      const inviter = await createTestUser(pool, { email: "inviter@test.com" })
      await addUserToWorkspace(pool, inviter.id, workspace.id)

      await workspaceService.createInvitation(workspace.id, "user@test.com", inviter.id)
      await workspaceService.createInvitation(workspace.id, "user@test.com", inviter.id)

      // Second invitation should revoke the first
      const pending = await workspaceService.getPendingInvitations(workspace.id)
      expect(pending.length).toBe(1)
    })
  })

  describe("Workspace Profiles", () => {
    test("should return empty profile for new member", async () => {
      const workspace = await createTestWorkspace(pool)
      const user = await createTestUser(pool)
      await addUserToWorkspace(pool, user.id, workspace.id)

      const profile = await workspaceService.getWorkspaceProfile(workspace.id, user.id)

      expect(profile).not.toBeNull()
      expect(profile?.displayName).toBeNull()
      expect(profile?.title).toBeNull()
      expect(profile?.profileManagedBySso).toBe(false)
    })

    test("should update workspace profile", async () => {
      const workspace = await createTestWorkspace(pool)
      const user = await createTestUser(pool)
      await addUserToWorkspace(pool, user.id, workspace.id)

      await workspaceService.updateWorkspaceProfile(workspace.id, user.id, {
        displayName: "John Doe",
        title: "Engineer",
      })

      const profile = await workspaceService.getWorkspaceProfile(workspace.id, user.id)

      expect(profile?.displayName).toBe("John Doe")
      expect(profile?.title).toBe("Engineer")
    })

    test("should indicate needs profile setup", async () => {
      const workspace = await createTestWorkspace(pool)
      const user = await createTestUser(pool)
      await addUserToWorkspace(pool, user.id, workspace.id)

      // Before setting up profile
      const needsSetup = await workspaceService.needsProfileSetup(workspace.id, user.id)
      expect(needsSetup).toBe(true)

      // After setting up profile
      await workspaceService.updateWorkspaceProfile(workspace.id, user.id, {
        displayName: "John Doe",
      })

      const needsSetupAfter = await workspaceService.needsProfileSetup(workspace.id, user.id)
      expect(needsSetupAfter).toBe(false)
    })

    test("should not update SSO-managed profile", async () => {
      const workspace = await createTestWorkspace(pool)
      const user = await createTestUser(pool)
      await addUserToWorkspace(pool, user.id, workspace.id)

      // Set profile as SSO-managed
      await pool.query(
        sql`INSERT INTO workspace_profiles (workspace_id, user_id, display_name, profile_managed_by_sso)
            VALUES (${workspace.id}, ${user.id}, 'SSO User', true)`,
      )

      await expect(
        workspaceService.updateWorkspaceProfile(workspace.id, user.id, {
          displayName: "New Name",
        }),
      ).rejects.toThrow("SSO")
    })
  })
})
