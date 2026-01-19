import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { Pool } from "pg"
import { withClient } from "./setup"
import { UserPreferencesService } from "../../src/services/user-preferences-service"
import { UserPreferencesRepository } from "../../src/repositories/user-preferences-repository"
import { workspaceId, userId } from "../../src/lib/id"
import { setupTestDatabase } from "./setup"
import { DEFAULT_USER_PREFERENCES } from "@threa/types"

describe("User Preferences - Sparse Override Pattern", () => {
  let pool: Pool
  let service: UserPreferencesService
  let testWorkspaceId: string
  let testUserId: string

  beforeAll(async () => {
    pool = await setupTestDatabase()
    service = new UserPreferencesService(pool)
  })

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    // Clean up and generate fresh IDs
    await pool.query("DELETE FROM user_preference_overrides")
    await pool.query("DELETE FROM outbox")
    testWorkspaceId = workspaceId()
    testUserId = userId()
  })

  describe("getPreferences", () => {
    test("should return defaults when no overrides exist", async () => {
      const prefs = await service.getPreferences(testWorkspaceId, testUserId)

      expect(prefs).toMatchObject({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        theme: DEFAULT_USER_PREFERENCES.theme,
        messageDisplay: DEFAULT_USER_PREFERENCES.messageDisplay,
        dateFormat: DEFAULT_USER_PREFERENCES.dateFormat,
        timeFormat: DEFAULT_USER_PREFERENCES.timeFormat,
        notificationLevel: DEFAULT_USER_PREFERENCES.notificationLevel,
        sidebarCollapsed: DEFAULT_USER_PREFERENCES.sidebarCollapsed,
        accessibility: DEFAULT_USER_PREFERENCES.accessibility,
      })

      // Verify no rows in database
      const overrides = await withClient(pool, (client) =>
        UserPreferencesRepository.findOverrides(client, testWorkspaceId, testUserId)
      )
      expect(overrides).toHaveLength(0)
    })
  })

  describe("updatePreferences - sparse storage", () => {
    test("should only store overrides that differ from defaults", async () => {
      // Update theme to non-default value
      await service.updatePreferences(testWorkspaceId, testUserId, {
        theme: "dark",
      })

      // Verify only one row exists
      const overrides = await withClient(pool, (client) =>
        UserPreferencesRepository.findOverrides(client, testWorkspaceId, testUserId)
      )
      expect(overrides).toHaveLength(1)
      expect(overrides[0]).toMatchObject({ key: "theme", value: "dark" })
    })

    test("should not store values that match defaults", async () => {
      // Update theme to the default value
      await service.updatePreferences(testWorkspaceId, testUserId, {
        theme: "system", // This is the default
      })

      // Verify no rows exist
      const overrides = await withClient(pool, (client) =>
        UserPreferencesRepository.findOverrides(client, testWorkspaceId, testUserId)
      )
      expect(overrides).toHaveLength(0)
    })

    test("should delete override when value reverts to default", async () => {
      // First set to non-default
      await service.updatePreferences(testWorkspaceId, testUserId, {
        theme: "dark",
      })

      let overrides = await withClient(pool, (client) =>
        UserPreferencesRepository.findOverrides(client, testWorkspaceId, testUserId)
      )
      expect(overrides).toHaveLength(1)

      // Revert to default
      await service.updatePreferences(testWorkspaceId, testUserId, {
        theme: "system",
      })

      overrides = await withClient(pool, (client) =>
        UserPreferencesRepository.findOverrides(client, testWorkspaceId, testUserId)
      )
      expect(overrides).toHaveLength(0)
    })

    test("should handle nested accessibility overrides", async () => {
      await service.updatePreferences(testWorkspaceId, testUserId, {
        accessibility: {
          fontSize: "large",
          reducedMotion: true,
        },
      })

      const overrides = await withClient(pool, (client) =>
        UserPreferencesRepository.findOverrides(client, testWorkspaceId, testUserId)
      )

      // Should have two separate rows for nested keys
      expect(overrides).toHaveLength(2)
      const keys = overrides.map((o) => o.key).sort()
      expect(keys).toEqual(["accessibility.fontSize", "accessibility.reducedMotion"])
    })

    test("should merge overrides with defaults when fetching", async () => {
      // Set only theme override
      await service.updatePreferences(testWorkspaceId, testUserId, {
        theme: "dark",
      })

      const prefs = await service.getPreferences(testWorkspaceId, testUserId)

      // Theme should be overridden
      expect(prefs.theme).toBe("dark")

      // Other values should be defaults
      expect(prefs.messageDisplay).toBe(DEFAULT_USER_PREFERENCES.messageDisplay)
      expect(prefs.dateFormat).toBe(DEFAULT_USER_PREFERENCES.dateFormat)
      expect(prefs.accessibility).toEqual(DEFAULT_USER_PREFERENCES.accessibility)
    })

    test("should handle multiple overrides correctly", async () => {
      await service.updatePreferences(testWorkspaceId, testUserId, {
        theme: "dark",
        messageDisplay: "compact",
        dateFormat: "DD/MM/YYYY",
        accessibility: {
          fontSize: "large",
        },
      })

      const overrides = await withClient(pool, (client) =>
        UserPreferencesRepository.findOverrides(client, testWorkspaceId, testUserId)
      )

      // Should have 4 overrides
      expect(overrides).toHaveLength(4)

      const prefs = await service.getPreferences(testWorkspaceId, testUserId)
      expect(prefs.theme).toBe("dark")
      expect(prefs.messageDisplay).toBe("compact")
      expect(prefs.dateFormat).toBe("DD/MM/YYYY")
      expect(prefs.accessibility.fontSize).toBe("large")
      // Non-overridden accessibility fields should be defaults
      expect(prefs.accessibility.reducedMotion).toBe(false)
      expect(prefs.accessibility.highContrast).toBe(false)
    })
  })

  describe("keyboard shortcuts", () => {
    test("should store keyboard shortcut overrides", async () => {
      await service.updatePreferences(testWorkspaceId, testUserId, {
        keyboardShortcuts: {
          openQuickSwitcher: "mod+p",
        },
      })

      const overrides = await withClient(pool, (client) =>
        UserPreferencesRepository.findOverrides(client, testWorkspaceId, testUserId)
      )

      expect(overrides).toHaveLength(1)
      expect(overrides[0]).toMatchObject({
        key: "keyboardShortcuts.openQuickSwitcher",
        value: "mod+p",
      })
    })
  })

  describe("outbox events", () => {
    test("should publish outbox event with merged preferences", async () => {
      await service.updatePreferences(testWorkspaceId, testUserId, {
        theme: "dark",
      })

      const result = await pool.query(
        `SELECT payload FROM outbox WHERE event_type = 'user_preferences:updated' ORDER BY id DESC LIMIT 1`
      )

      expect(result.rows).toHaveLength(1)
      const payload = result.rows[0].payload

      // Payload should contain full merged preferences, not just overrides
      expect(payload.preferences.theme).toBe("dark")
      expect(payload.preferences.messageDisplay).toBe(DEFAULT_USER_PREFERENCES.messageDisplay)
    })
  })
})
