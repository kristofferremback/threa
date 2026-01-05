import { PoolClient } from "pg"
import { sql } from "../db"

/**
 * Internal row type for preference overrides (snake_case)
 */
interface PreferenceOverrideRow {
  workspace_id: string
  user_id: string
  key: string
  value: unknown
  created_at: Date
  updated_at: Date
}

/**
 * Override record returned from repository
 */
export interface PreferenceOverrideRecord {
  key: string
  value: unknown
}

export const UserPreferencesRepository = {
  /**
   * Fetch all preference overrides for a workspace/user.
   * Returns only the overrides - merge with defaults in service layer.
   */
  async findOverrides(client: PoolClient, workspaceId: string, userId: string): Promise<PreferenceOverrideRecord[]> {
    const result = await client.query<PreferenceOverrideRow>(sql`
      SELECT key, value
      FROM user_preference_overrides
      WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
    `)
    return result.rows.map((row) => ({
      key: row.key,
      value: row.value,
    }))
  },

  /**
   * Set a single preference override.
   * Uses upsert to handle both insert and update.
   */
  async setOverride(
    client: PoolClient,
    workspaceId: string,
    userId: string,
    key: string,
    value: unknown
  ): Promise<void> {
    await client.query(sql`
      INSERT INTO user_preference_overrides (workspace_id, user_id, key, value)
      VALUES (${workspaceId}, ${userId}, ${key}, ${JSON.stringify(value)}::jsonb)
      ON CONFLICT (workspace_id, user_id, key) DO UPDATE SET
        value = ${JSON.stringify(value)}::jsonb,
        updated_at = NOW()
    `)
  },

  /**
   * Remove a preference override (revert to default).
   */
  async deleteOverride(client: PoolClient, workspaceId: string, userId: string, key: string): Promise<void> {
    await client.query(sql`
      DELETE FROM user_preference_overrides
      WHERE workspace_id = ${workspaceId}
        AND user_id = ${userId}
        AND key = ${key}
    `)
  },

  /**
   * Bulk set/delete overrides in a single transaction.
   * For each key: if value differs from default, upsert; if matches default, delete.
   */
  async bulkSetOverrides(
    client: PoolClient,
    workspaceId: string,
    userId: string,
    overrides: Array<{ key: string; value: unknown }>
  ): Promise<void> {
    if (overrides.length === 0) return

    // Build a multi-value INSERT with ON CONFLICT UPDATE
    const placeholders: string[] = []
    const values: unknown[] = []
    let idx = 1

    for (const { key, value } of overrides) {
      placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}::jsonb)`)
      values.push(workspaceId, userId, key, JSON.stringify(value))
    }

    await client.query(
      `INSERT INTO user_preference_overrides (workspace_id, user_id, key, value)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (workspace_id, user_id, key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      values
    )
  },

  /**
   * Delete multiple overrides by key.
   */
  async bulkDeleteOverrides(client: PoolClient, workspaceId: string, userId: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return

    await client.query(sql`
      DELETE FROM user_preference_overrides
      WHERE workspace_id = ${workspaceId}
        AND user_id = ${userId}
        AND key = ANY(${keys})
    `)
  },

  /**
   * Delete all overrides for a user in a workspace (reset to defaults).
   */
  async deleteAllOverrides(client: PoolClient, workspaceId: string, userId: string): Promise<void> {
    await client.query(sql`
      DELETE FROM user_preference_overrides
      WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
    `)
  },

  /**
   * List all overrides for a user across all workspaces.
   */
  async listByUser(
    client: PoolClient,
    userId: string
  ): Promise<Array<{ workspaceId: string; key: string; value: unknown }>> {
    const result = await client.query<PreferenceOverrideRow>(sql`
      SELECT workspace_id, key, value
      FROM user_preference_overrides
      WHERE user_id = ${userId}
      ORDER BY workspace_id, key
    `)
    return result.rows.map((row) => ({
      workspaceId: row.workspace_id,
      key: row.key,
      value: row.value,
    }))
  },
}
