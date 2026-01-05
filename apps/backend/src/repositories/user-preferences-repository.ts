import { PoolClient } from "pg"
import { sql } from "../db"
import type {
  UserPreferences,
  AccessibilityPreferences,
  KeyboardShortcuts,
  Theme,
  MessageDisplay,
  DateFormat,
  TimeFormat,
  NotificationLevel,
  UpdateUserPreferencesInput,
} from "@threa/types"

// Internal row type (snake_case, not exported)
interface UserPreferencesRow {
  workspace_id: string
  user_id: string
  theme: string
  message_display: string
  date_format: string
  time_format: string
  timezone: string
  language: string
  notification_level: string
  sidebar_collapsed: boolean
  keyboard_shortcuts: KeyboardShortcuts
  accessibility: AccessibilityPreferences
  created_at: Date
  updated_at: Date
}

function mapRowToPreferences(row: UserPreferencesRow): UserPreferences {
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    theme: row.theme as Theme,
    messageDisplay: row.message_display as MessageDisplay,
    dateFormat: row.date_format as DateFormat,
    timeFormat: row.time_format as TimeFormat,
    timezone: row.timezone,
    language: row.language,
    notificationLevel: row.notification_level as NotificationLevel,
    sidebarCollapsed: row.sidebar_collapsed,
    keyboardShortcuts: row.keyboard_shortcuts,
    accessibility: row.accessibility,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

const SELECT_COLUMNS = `
  workspace_id, user_id, theme, message_display, date_format, time_format,
  timezone, language, notification_level, sidebar_collapsed,
  keyboard_shortcuts, accessibility, created_at, updated_at
`

export const UserPreferencesRepository = {
  async findByWorkspaceAndUser(
    client: PoolClient,
    workspaceId: string,
    userId: string
  ): Promise<UserPreferences | null> {
    const result = await client.query<UserPreferencesRow>(sql`
      SELECT ${sql.raw(SELECT_COLUMNS)}
      FROM user_preferences
      WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
    `)
    return result.rows[0] ? mapRowToPreferences(result.rows[0]) : null
  },

  /**
   * Get preferences or create with defaults if they don't exist.
   * Uses INSERT ... ON CONFLICT DO NOTHING to avoid race conditions.
   */
  async getOrCreateDefaults(client: PoolClient, workspaceId: string, userId: string): Promise<UserPreferences> {
    // Try to insert with defaults, do nothing if exists
    await client.query(sql`
      INSERT INTO user_preferences (workspace_id, user_id)
      VALUES (${workspaceId}, ${userId})
      ON CONFLICT (workspace_id, user_id) DO NOTHING
    `)

    // Fetch the row (either just inserted or already existed)
    const result = await client.query<UserPreferencesRow>(sql`
      SELECT ${sql.raw(SELECT_COLUMNS)}
      FROM user_preferences
      WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
    `)

    if (!result.rows[0]) {
      throw new Error("Failed to get or create user preferences")
    }

    return mapRowToPreferences(result.rows[0])
  },

  /**
   * Update preferences with partial data.
   * Only updates fields that are provided (non-undefined).
   * Creates the row if it doesn't exist (upsert).
   */
  async upsert(
    client: PoolClient,
    workspaceId: string,
    userId: string,
    updates: UpdateUserPreferencesInput
  ): Promise<UserPreferences> {
    // Build SET clause dynamically for only provided fields
    const sets: string[] = ["updated_at = NOW()"]
    const values: unknown[] = []
    let paramIndex = 3 // $1 = workspaceId, $2 = userId

    if (updates.theme !== undefined) {
      sets.push(`theme = $${paramIndex++}`)
      values.push(updates.theme)
    }
    if (updates.messageDisplay !== undefined) {
      sets.push(`message_display = $${paramIndex++}`)
      values.push(updates.messageDisplay)
    }
    if (updates.dateFormat !== undefined) {
      sets.push(`date_format = $${paramIndex++}`)
      values.push(updates.dateFormat)
    }
    if (updates.timeFormat !== undefined) {
      sets.push(`time_format = $${paramIndex++}`)
      values.push(updates.timeFormat)
    }
    if (updates.timezone !== undefined) {
      sets.push(`timezone = $${paramIndex++}`)
      values.push(updates.timezone)
    }
    if (updates.language !== undefined) {
      sets.push(`language = $${paramIndex++}`)
      values.push(updates.language)
    }
    if (updates.notificationLevel !== undefined) {
      sets.push(`notification_level = $${paramIndex++}`)
      values.push(updates.notificationLevel)
    }
    if (updates.sidebarCollapsed !== undefined) {
      sets.push(`sidebar_collapsed = $${paramIndex++}`)
      values.push(updates.sidebarCollapsed)
    }
    if (updates.keyboardShortcuts !== undefined) {
      sets.push(`keyboard_shortcuts = $${paramIndex++}`)
      values.push(JSON.stringify(updates.keyboardShortcuts))
    }
    if (updates.accessibility !== undefined) {
      // Merge with existing accessibility (partial update)
      // Must qualify with table name to avoid ambiguity in ON CONFLICT DO UPDATE
      sets.push(`accessibility = user_preferences.accessibility || $${paramIndex++}::jsonb`)
      values.push(JSON.stringify(updates.accessibility))
    }

    // If no updates provided, just get or create defaults
    if (values.length === 0) {
      return this.getOrCreateDefaults(client, workspaceId, userId)
    }

    // Use INSERT ... ON CONFLICT DO UPDATE for atomic upsert
    const query = `
      INSERT INTO user_preferences (workspace_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET
        ${sets.join(", ")}
      RETURNING ${SELECT_COLUMNS}
    `

    const result = await client.query<UserPreferencesRow>(query, [workspaceId, userId, ...values])
    return mapRowToPreferences(result.rows[0])
  },

  /**
   * List preferences for a user across all workspaces.
   */
  async listByUser(client: PoolClient, userId: string): Promise<UserPreferences[]> {
    const result = await client.query<UserPreferencesRow>(sql`
      SELECT ${sql.raw(SELECT_COLUMNS)}
      FROM user_preferences
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC
    `)
    return result.rows.map(mapRowToPreferences)
  },
}
