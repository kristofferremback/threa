import { Pool } from "pg"
import { sql } from "../lib/db"
import { logger } from "../lib/logger"

/**
 * UserSettingsService - Manages user preferences per workspace.
 *
 * Settings are stored as JSONB in the user_workspace_settings table,
 * allowing flexible schema for different setting types.
 */

export type CollapseState = "open" | "soft" | "hard"

export interface SidebarCollapseSettings {
  pinned: CollapseState
  channels: CollapseState
  thinkingSpaces: CollapseState
  directMessages: CollapseState
}

export interface UserSettings {
  theme?: "light" | "dark" | "system"
  sidebarCollapse?: SidebarCollapseSettings
  // Future settings can be added here
  notifications?: {
    desktop?: boolean
    sound?: boolean
    mentions?: boolean
  }
}

const DEFAULT_SETTINGS: UserSettings = {
  theme: "system",
  sidebarCollapse: {
    pinned: "open",
    channels: "open",
    thinkingSpaces: "open",
    directMessages: "open",
  },
  notifications: {
    desktop: true,
    sound: true,
    mentions: true,
  },
}

export class UserSettingsService {
  constructor(private pool: Pool) {}

  /**
   * Get user settings for a workspace, merging with defaults.
   */
  async getSettings(userId: string, workspaceId: string): Promise<UserSettings> {
    const result = await this.pool.query<{ settings: UserSettings }>(
      sql`SELECT settings FROM user_workspace_settings
          WHERE user_id = ${userId} AND workspace_id = ${workspaceId}
          AND deleted_at IS NULL`,
    )

    if (result.rows.length === 0) {
      return { ...DEFAULT_SETTINGS }
    }

    // Deep merge with defaults to ensure all fields exist
    return this.mergeWithDefaults(result.rows[0].settings)
  }

  /**
   * Update user settings (partial update, merges with existing).
   */
  async updateSettings(
    userId: string,
    workspaceId: string,
    updates: Partial<UserSettings>,
  ): Promise<UserSettings> {
    // Get current settings
    const current = await this.getSettings(userId, workspaceId)

    // Deep merge updates
    const merged = this.deepMerge(current, updates)

    // Upsert
    await this.pool.query(
      sql`INSERT INTO user_workspace_settings (user_id, workspace_id, settings, created_at, updated_at)
          VALUES (${userId}, ${workspaceId}, ${JSON.stringify(merged)}::jsonb, NOW(), NOW())
          ON CONFLICT (user_id, workspace_id) DO UPDATE
          SET settings = ${JSON.stringify(merged)}::jsonb,
              updated_at = NOW()`,
    )

    logger.debug({ userId, workspaceId, updates }, "User settings updated")

    return merged
  }

  /**
   * Update a specific setting path (e.g., "sidebarCollapse.channels").
   */
  async updateSetting(
    userId: string,
    workspaceId: string,
    path: string,
    value: unknown,
  ): Promise<UserSettings> {
    const current = await this.getSettings(userId, workspaceId)

    // Set nested value by path
    const updated = this.setNestedValue(current, path, value)

    await this.pool.query(
      sql`INSERT INTO user_workspace_settings (user_id, workspace_id, settings, created_at, updated_at)
          VALUES (${userId}, ${workspaceId}, ${JSON.stringify(updated)}::jsonb, NOW(), NOW())
          ON CONFLICT (user_id, workspace_id) DO UPDATE
          SET settings = ${JSON.stringify(updated)}::jsonb,
              updated_at = NOW()`,
    )

    logger.debug({ userId, workspaceId, path, value }, "User setting updated")

    return updated
  }

  /**
   * Get a specific setting path.
   */
  async getSetting<T>(userId: string, workspaceId: string, path: string): Promise<T | undefined> {
    const settings = await this.getSettings(userId, workspaceId)
    return this.getNestedValue(settings, path) as T | undefined
  }

  /**
   * Reset settings to defaults.
   */
  async resetSettings(userId: string, workspaceId: string): Promise<UserSettings> {
    await this.pool.query(
      sql`DELETE FROM user_workspace_settings
          WHERE user_id = ${userId} AND workspace_id = ${workspaceId}`,
    )

    logger.info({ userId, workspaceId }, "User settings reset to defaults")

    return { ...DEFAULT_SETTINGS }
  }

  private mergeWithDefaults(settings: Partial<UserSettings>): UserSettings {
    return this.deepMerge({ ...DEFAULT_SETTINGS }, settings)
  }

  private deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
    const result = { ...target }

    for (const key in source) {
      const sourceValue = source[key]
      const targetValue = target[key]

      if (
        sourceValue !== null &&
        typeof sourceValue === "object" &&
        !Array.isArray(sourceValue) &&
        targetValue !== null &&
        typeof targetValue === "object" &&
        !Array.isArray(targetValue)
      ) {
        result[key] = this.deepMerge(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>,
        ) as T[Extract<keyof T, string>]
      } else if (sourceValue !== undefined) {
        result[key] = sourceValue as T[Extract<keyof T, string>]
      }
    }

    return result
  }

  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): UserSettings {
    const keys = path.split(".")
    const result = { ...obj } as Record<string, unknown>
    let current = result

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i]
      if (typeof current[key] !== "object" || current[key] === null) {
        current[key] = {}
      } else {
        current[key] = { ...(current[key] as Record<string, unknown>) }
      }
      current = current[key] as Record<string, unknown>
    }

    current[keys[keys.length - 1]] = value
    return result as UserSettings
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const keys = path.split(".")
    let current: unknown = obj

    for (const key of keys) {
      if (current === null || typeof current !== "object") {
        return undefined
      }
      current = (current as Record<string, unknown>)[key]
    }

    return current
  }
}
