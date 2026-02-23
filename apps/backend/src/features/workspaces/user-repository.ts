import type { Querier } from "../../db"
import { sql } from "../../db"

interface UserRow {
  id: string
  workspace_id: string
  workos_user_id: string
  email: string
  role: string
  slug: string
  name: string
  description: string | null
  avatar_url: string | null
  timezone: string | null
  locale: string | null
  setup_completed: boolean
  joined_at: Date
}

interface UserAccessRow extends Partial<UserRow> {
  workspace_exists: boolean
}

export interface User {
  id: string
  workspaceId: string
  workosUserId: string
  email: string
  role: "owner" | "admin" | "user"
  slug: string
  name: string
  description: string | null
  avatarUrl: string | null
  timezone: string | null
  locale: string | null
  setupCompleted: boolean
  joinedAt: Date
}

export interface InsertUserParams {
  id: string
  workspaceId: string
  workosUserId: string
  email: string
  name: string
  role: "owner" | "admin" | "user"
  slug: string
  timezone?: string | null
  locale?: string | null
  setupCompleted?: boolean
}

export interface UpdateUserParams {
  slug?: string
  name?: string
  description?: string | null
  avatarUrl?: string | null
  timezone?: string
  locale?: string
  setupCompleted?: boolean
}

const SELECT_FIELDS = `
  id, workspace_id, workos_user_id, email, role, slug,
  name, description, avatar_url, timezone, locale, setup_completed, joined_at
`

const SELECT_FIELDS_WITH_ALIAS = `
  u.id, u.workspace_id, u.workos_user_id, u.email, u.role, u.slug,
  u.name, u.description, u.avatar_url, u.timezone, u.locale, u.setup_completed, u.joined_at
`

function mapRowToUser(row: UserRow): User {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workosUserId: row.workos_user_id,
    email: row.email,
    role: row.role as User["role"],
    slug: row.slug,
    name: row.name,
    description: row.description,
    avatarUrl: row.avatar_url,
    timezone: row.timezone,
    locale: row.locale,
    setupCompleted: row.setup_completed,
    joinedAt: row.joined_at,
  }
}

export const UserRepository = {
  async findById(db: Querier, id: string): Promise<User | null> {
    const result = await db.query<UserRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS_WITH_ALIAS)}
      FROM users u
      WHERE u.id = ${id}
    `)
    return result.rows[0] ? mapRowToUser(result.rows[0]) : null
  },

  async findByWorkosUserIdInWorkspace(db: Querier, workspaceId: string, workosUserId: string): Promise<User | null> {
    const result = await db.query<UserRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS_WITH_ALIAS)}
      FROM users u
      WHERE u.workspace_id = ${workspaceId} AND u.workos_user_id = ${workosUserId}
    `)
    return result.rows[0] ? mapRowToUser(result.rows[0]) : null
  },

  async findWorkspaceUserAccess(
    db: Querier,
    workspaceId: string,
    workosUserId: string
  ): Promise<{ workspaceExists: boolean; user: User | null }> {
    const result = await db.query<UserAccessRow>(sql`
      WITH user_match AS (
        SELECT ${sql.raw(SELECT_FIELDS_WITH_ALIAS)}
        FROM users u
        WHERE u.workspace_id = ${workspaceId} AND u.workos_user_id = ${workosUserId}
        LIMIT 1
      )
      SELECT
        EXISTS(SELECT 1 FROM workspaces WHERE id = ${workspaceId}) AS workspace_exists,
        um.id,
        um.workspace_id,
        um.workos_user_id,
        um.email,
        um.role,
        um.slug,
        um.name,
        um.description,
        um.avatar_url,
        um.timezone,
        um.locale,
        um.setup_completed,
        um.joined_at
      FROM (SELECT 1) AS one
      LEFT JOIN user_match um ON true
    `)

    const row = result.rows[0]
    if (!row.workspace_exists) {
      return { workspaceExists: false, user: null }
    }

    const user = row.id ? mapRowToUser(row as UserRow) : null
    return { workspaceExists: true, user }
  },

  async findBySlug(db: Querier, workspaceId: string, slug: string): Promise<User | null> {
    const result = await db.query<UserRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS_WITH_ALIAS)}
      FROM users u
      WHERE u.workspace_id = ${workspaceId} AND u.slug = ${slug}
    `)
    return result.rows[0] ? mapRowToUser(result.rows[0]) : null
  },

  async findBySlugs(db: Querier, workspaceId: string, slugs: string[]): Promise<User[]> {
    if (slugs.length === 0) return []

    const result = await db.query<UserRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS_WITH_ALIAS)}
      FROM users u
      WHERE u.workspace_id = ${workspaceId} AND u.slug = ANY(${slugs})
    `)
    return result.rows.map(mapRowToUser)
  },

  async findByIds(db: Querier, workspaceId: string, ids: string[]): Promise<User[]> {
    if (ids.length === 0) return []

    const result = await db.query<UserRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS_WITH_ALIAS)}
      FROM users u
      WHERE u.workspace_id = ${workspaceId} AND u.id = ANY(${ids})
    `)
    return result.rows.map(mapRowToUser)
  },

  async listByWorkspace(db: Querier, workspaceId: string): Promise<User[]> {
    const result = await db.query<UserRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS_WITH_ALIAS)}
      FROM users u
      WHERE u.workspace_id = ${workspaceId}
      ORDER BY u.joined_at
    `)
    return result.rows.map(mapRowToUser)
  },

  async insert(db: Querier, params: InsertUserParams): Promise<User> {
    const result = await db.query<UserRow>(sql`
      INSERT INTO users (id, workspace_id, workos_user_id, email, role, slug, name, timezone, locale, setup_completed)
      VALUES (
        ${params.id},
        ${params.workspaceId},
        ${params.workosUserId},
        ${params.email},
        ${params.role},
        ${params.slug},
        ${params.name},
        ${params.timezone ?? null},
        ${params.locale ?? null},
        ${params.setupCompleted ?? true}
      )
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return mapRowToUser(result.rows[0])
  },

  async remove(db: Querier, workspaceId: string, userId: string): Promise<void> {
    await db.query(sql`
      DELETE FROM users
      WHERE workspace_id = ${workspaceId} AND id = ${userId}
    `)
  },

  async removeByWorkosUserId(db: Querier, workspaceId: string, workosUserId: string): Promise<void> {
    await db.query(sql`
      DELETE FROM users
      WHERE workspace_id = ${workspaceId} AND workos_user_id = ${workosUserId}
    `)
  },

  async isMember(db: Querier, workspaceId: string, workosUserId: string): Promise<boolean> {
    const result = await db.query(sql`
      SELECT 1 FROM users
      WHERE workspace_id = ${workspaceId} AND workos_user_id = ${workosUserId}
    `)
    return result.rows.length > 0
  },

  async findEmails(db: Querier, workspaceId: string, emails: string[]): Promise<Set<string>> {
    if (emails.length === 0) return new Set()

    const result = await db.query<{ email: string }>(sql`
      SELECT email FROM users
      WHERE workspace_id = ${workspaceId} AND email = ANY(${emails})
    `)
    return new Set(result.rows.map((r) => r.email))
  },

  async update(db: Querier, userId: string, params: UpdateUserParams): Promise<User | null> {
    const sets: string[] = []
    const values: unknown[] = []
    let paramIndex = 1

    if (params.slug !== undefined) {
      sets.push(`slug = $${paramIndex++}`)
      values.push(params.slug)
    }
    if (params.name !== undefined) {
      sets.push(`name = $${paramIndex++}`)
      values.push(params.name)
    }
    if (params.description !== undefined) {
      sets.push(`description = $${paramIndex++}`)
      values.push(params.description)
    }
    if (params.avatarUrl !== undefined) {
      sets.push(`avatar_url = $${paramIndex++}`)
      values.push(params.avatarUrl)
    }
    if (params.timezone !== undefined) {
      sets.push(`timezone = $${paramIndex++}`)
      values.push(params.timezone)
    }
    if (params.locale !== undefined) {
      sets.push(`locale = $${paramIndex++}`)
      values.push(params.locale)
    }
    if (params.setupCompleted !== undefined) {
      sets.push(`setup_completed = $${paramIndex++}`)
      values.push(params.setupCompleted)
    }

    if (sets.length === 0) return null

    values.push(userId)
    let whereClause = `WHERE id = $${paramIndex}`
    if (params.setupCompleted === true) {
      whereClause += ` AND setup_completed = false`
    }

    const query = `
      UPDATE users SET ${sets.join(", ")}
      ${whereClause}
      RETURNING id, workspace_id, workos_user_id, email, role, slug,
                name, description, avatar_url, timezone, locale, setup_completed, joined_at
    `
    const result = await db.query<UserRow>(query, values)
    return result.rows[0] ? mapRowToUser(result.rows[0]) : null
  },

  async updateAvatarIfLatestUpload(
    db: Querier,
    userId: string,
    avatarUploadId: string,
    avatarUrl: string
  ): Promise<User | null> {
    const result = await db.query<UserRow>(sql`
      UPDATE users SET avatar_url = ${avatarUrl}
      WHERE id = ${userId}
        AND ${avatarUploadId} = (
          SELECT id FROM avatar_uploads
          WHERE user_id = ${userId}
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        )
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return result.rows[0] ? mapRowToUser(result.rows[0]) : null
  },

  async slugExistsInWorkspace(db: Querier, workspaceId: string, slug: string): Promise<boolean> {
    const result = await db.query(sql`
      SELECT 1 FROM users
      WHERE workspace_id = ${workspaceId} AND slug = ${slug}
    `)
    return result.rows.length > 0
  },

  /**
   * Search for users in a workspace by name, email, or slug.
   * Uses pg_trgm trigram similarity for fuzzy matching (handles typos),
   * combined with ILIKE for exact substring matches.
   */
  async searchByNameOrSlug(db: Querier, workspaceId: string, query: string, limit: number): Promise<User[]> {
    const pattern = `%${query}%`
    const result = await db.query<UserRow>(sql`
      SELECT DISTINCT ${sql.raw(SELECT_FIELDS_WITH_ALIAS)},
        GREATEST(
          similarity(u.name, ${query}),
          similarity(u.email, ${query}),
          similarity(u.slug, ${query})
        ) AS sim_score
      FROM users u
      WHERE u.workspace_id = ${workspaceId}
        AND (
          u.name % ${query}
          OR u.email % ${query}
          OR u.slug % ${query}
          OR u.name ILIKE ${pattern}
          OR u.email ILIKE ${pattern}
          OR u.slug ILIKE ${pattern}
        )
      ORDER BY sim_score DESC, u.name
      LIMIT ${limit}
    `)
    return result.rows.map(mapRowToUser)
  },
}
