import { Pool } from "pg"
import { withClient, withTransaction } from "../db"
import { UserPreferencesRepository } from "../repositories/user-preferences-repository"
import { OutboxRepository } from "../repositories"
import type { UserPreferences, UpdateUserPreferencesInput } from "@threa/types"

export class UserPreferencesService {
  constructor(private pool: Pool) {}

  /**
   * Get user preferences for a workspace, creating defaults if they don't exist.
   */
  async getPreferences(workspaceId: string, userId: string): Promise<UserPreferences> {
    return withClient(this.pool, (client) => UserPreferencesRepository.getOrCreateDefaults(client, workspaceId, userId))
  }

  /**
   * Update user preferences and broadcast to all user's devices via outbox.
   */
  async updatePreferences(
    workspaceId: string,
    userId: string,
    updates: UpdateUserPreferencesInput
  ): Promise<UserPreferences> {
    return withTransaction(this.pool, async (client) => {
      const preferences = await UserPreferencesRepository.upsert(client, workspaceId, userId, updates)

      // Publish outbox event for real-time sync across all user's devices
      await OutboxRepository.insert(client, "user_preferences:updated", {
        workspaceId,
        authorId: userId,
        preferences,
      })

      return preferences
    })
  }
}
