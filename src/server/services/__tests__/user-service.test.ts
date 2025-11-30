import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { Pool } from "pg"
import { UserService } from "../user-service"
import {
  getTestPool,
  closeTestPool,
  cleanupTestData,
  createTestUser,
  createTestWorkspace,
  createTestStream,
} from "./test-helpers"

describe("UserService", () => {
  let pool: Pool
  let userService: UserService

  beforeAll(async () => {
    pool = await getTestPool()
    userService = new UserService(pool)
  })

  afterAll(async () => {
    await closeTestPool()
  })

  beforeEach(async () => {
    await cleanupTestData(pool)
  })

  describe("ensureUser", () => {
    test("should create new user", async () => {
      await userService.ensureUser({
        id: "usr_new_123",
        email: "new@test.com",
        firstName: "New",
        lastName: "User",
      })

      const user = await userService.getUserById("usr_new_123")

      expect(user).not.toBeNull()
      expect(user?.email).toBe("new@test.com")
      expect(user?.name).toBe("New User")
    })

    test("should update existing user", async () => {
      // Create user with initial data
      await userService.ensureUser({
        id: "usr_existing",
        email: "old@test.com",
        firstName: "Old",
        lastName: "Name",
      })

      // Update with new data
      await userService.ensureUser({
        id: "usr_existing",
        email: "new@test.com",
        firstName: "New",
        lastName: "Name",
      })

      const user = await userService.getUserById("usr_existing")

      expect(user?.email).toBe("new@test.com")
      expect(user?.name).toBe("New Name")
    })

    test("should use email as name if no first/last name", async () => {
      await userService.ensureUser({
        id: "usr_no_name",
        email: "user@test.com",
        firstName: null,
        lastName: null,
      })

      const user = await userService.getUserById("usr_no_name")

      expect(user?.name).toBe("user@test.com")
    })
  })

  describe("getUserById", () => {
    test("should return user by id", async () => {
      const created = await createTestUser(pool, {
        id: "usr_test_1",
        email: "test@example.com",
        name: "Test User",
      })

      const user = await userService.getUserById(created.id)

      expect(user).not.toBeNull()
      expect(user?.id).toBe("usr_test_1")
      expect(user?.email).toBe("test@example.com")
      expect(user?.name).toBe("Test User")
    })

    test("should return null for non-existent user", async () => {
      const user = await userService.getUserById("non-existent-id")
      expect(user).toBeNull()
    })

    test("should not return deleted users", async () => {
      const created = await createTestUser(pool, { id: "usr_deleted" })

      // Soft delete the user
      await pool.query("UPDATE users SET deleted_at = NOW() WHERE id = $1", [created.id])

      const user = await userService.getUserById(created.id)
      expect(user).toBeNull()
    })
  })

  describe("getUserEmail", () => {
    test("should return email for valid user", async () => {
      const created = await createTestUser(pool, { email: "specific@test.com" })

      const email = await userService.getUserEmail(created.id)

      expect(email).toBe("specific@test.com")
    })

    test("should return null for non-existent user", async () => {
      const email = await userService.getUserEmail("non-existent-id")
      expect(email).toBeNull()
    })
  })

  describe("updateProfile", () => {
    test("should update user name", async () => {
      const created = await createTestUser(pool, { name: "Old Name" })

      const updated = await userService.updateProfile(created.id, { name: "New Name" })

      expect(updated?.name).toBe("New Name")
    })

    test("should return null for non-existent user", async () => {
      const result = await userService.updateProfile("non-existent", { name: "Test" })
      expect(result).toBeNull()
    })

    test("should not update deleted user", async () => {
      const created = await createTestUser(pool)
      await pool.query("UPDATE users SET deleted_at = NOW() WHERE id = $1", [created.id])

      const result = await userService.updateProfile(created.id, { name: "New Name" })
      expect(result).toBeNull()
    })
  })

  describe("needsProfileSetup", () => {
    test("should return true if name is null", () => {
      const user = { name: null } as any
      expect(userService.needsProfileSetup(user)).toBe(true)
    })

    test("should return true if name contains @", () => {
      const user = { name: "user@example.com" } as any
      expect(userService.needsProfileSetup(user)).toBe(true)
    })

    test("should return false if name is set properly", () => {
      const user = { name: "John Doe" } as any
      expect(userService.needsProfileSetup(user)).toBe(false)
    })
  })

  describe("getWorkspaceIdForChannel", () => {
    test("should return workspace id for stream id", async () => {
      const workspace = await createTestWorkspace(pool)
      // Use an ID that starts with stream_ since the method checks for this prefix
      const stream = await createTestStream(pool, workspace.id, {
        id: `stream_test_${Date.now()}`,
        slug: "test-channel",
      })

      const workspaceId = await userService.getWorkspaceIdForChannel(stream.id)

      expect(workspaceId).toBe(workspace.id)
    })

    test("should return workspace id for stream slug", async () => {
      const workspace = await createTestWorkspace(pool)
      await createTestStream(pool, workspace.id, { slug: "my-channel" })

      const workspaceId = await userService.getWorkspaceIdForChannel("my-channel")

      expect(workspaceId).toBe(workspace.id)
    })

    test("should return null for non-existent stream", async () => {
      const workspaceId = await userService.getWorkspaceIdForChannel("non-existent")
      expect(workspaceId).toBeNull()
    })
  })
})
