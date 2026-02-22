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

export interface User {
  id: string
  workspaceId: string
  workosUserId: string
  email: string
  role: "owner" | "admin" | "member"
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
  role: "owner" | "admin" | "member"
  slug: string
}

const SELECT_FIELDS = `
  wm.id, wm.workspace_id, wm.workos_user_id, wm.email, wm.role, wm.slug,
  wm.name, wm.description, wm.avatar_url, wm.timezone, wm.locale, wm.setup_completed, wm.joined_at
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
      SELECT ${sql.raw(SELECT_FIELDS)}
      FROM workspace_members wm
      WHERE wm.id = ${id}
    `)
    return result.rows[0] ? mapRowToUser(result.rows[0]) : null
  },

  async findByWorkosUserIdInWorkspace(db: Querier, workspaceId: string, workosUserId: string): Promise<User | null> {
    const result = await db.query<UserRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)}
      FROM workspace_members wm
      WHERE wm.workspace_id = ${workspaceId} AND wm.workos_user_id = ${workosUserId}
    `)
    return result.rows[0] ? mapRowToUser(result.rows[0]) : null
  },

  async findBySlug(db: Querier, workspaceId: string, slug: string): Promise<User | null> {
    const result = await db.query<UserRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)}
      FROM workspace_members wm
      WHERE wm.workspace_id = ${workspaceId} AND wm.slug = ${slug}
    `)
    return result.rows[0] ? mapRowToUser(result.rows[0]) : null
  },

  async findBySlugs(db: Querier, workspaceId: string, slugs: string[]): Promise<User[]> {
    if (slugs.length === 0) return []

    const result = await db.query<UserRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)}
      FROM workspace_members wm
      WHERE wm.workspace_id = ${workspaceId} AND wm.slug = ANY(${slugs})
    `)
    return result.rows.map(mapRowToUser)
  },

  async findByIds(db: Querier, ids: string[]): Promise<User[]> {
    if (ids.length === 0) return []

    const result = await db.query<UserRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)}
      FROM workspace_members wm
      WHERE wm.id = ANY(${ids})
    `)
    return result.rows.map(mapRowToUser)
  },

  async listByWorkspace(db: Querier, workspaceId: string): Promise<User[]> {
    const result = await db.query<UserRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)}
      FROM workspace_members wm
      WHERE wm.workspace_id = ${workspaceId}
      ORDER BY wm.joined_at
    `)
    return result.rows.map(mapRowToUser)
  },

  async insert(db: Querier, params: InsertUserParams): Promise<User> {
    await db.query(sql`
      INSERT INTO workspace_members (id, workspace_id, workos_user_id, email, role, slug, name)
      VALUES (${params.id}, ${params.workspaceId}, ${params.workosUserId}, ${params.email}, ${params.role}, ${params.slug}, ${params.name})
    `)
    const user = await this.findById(db, params.id)
    if (!user) throw new Error("Failed to insert user")
    return user
  },

  async remove(db: Querier, workspaceId: string, memberId: string): Promise<void> {
    await db.query(sql`
      DELETE FROM workspace_members
      WHERE workspace_id = ${workspaceId} AND id = ${memberId}
    `)
  },

  async isMember(db: Querier, workspaceId: string, workosUserId: string): Promise<boolean> {
    const result = await db.query(sql`
      SELECT 1 FROM workspace_members
      WHERE workspace_id = ${workspaceId} AND workos_user_id = ${workosUserId}
    `)
    return result.rows.length > 0
  },

  async updateSlug(db: Querier, id: string, slug: string): Promise<void> {
    await db.query(sql`
      UPDATE workspace_members SET slug = ${slug}
      WHERE id = ${id}
    `)
  },

  async updateTimezone(db: Querier, id: string, timezone: string): Promise<void> {
    await db.query(sql`
      UPDATE workspace_members SET timezone = ${timezone}
      WHERE id = ${id}
    `)
  },

  async updateLocale(db: Querier, id: string, locale: string): Promise<void> {
    await db.query(sql`
      UPDATE workspace_members SET locale = ${locale}
      WHERE id = ${id}
    `)
  },

  async slugExistsInWorkspace(db: Querier, workspaceId: string, slug: string): Promise<boolean> {
    const result = await db.query(sql`
      SELECT 1 FROM workspace_members
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
      SELECT DISTINCT ${sql.raw(SELECT_FIELDS)},
        GREATEST(
          similarity(wm.name, ${query}),
          similarity(wm.email, ${query}),
          similarity(wm.slug, ${query})
        ) AS sim_score
      FROM workspace_members wm
      WHERE wm.workspace_id = ${workspaceId}
        AND (
          wm.name % ${query}
          OR wm.email % ${query}
          OR wm.slug % ${query}
          OR wm.name ILIKE ${pattern}
          OR wm.email ILIKE ${pattern}
          OR wm.slug ILIKE ${pattern}
        )
      ORDER BY sim_score DESC, wm.name
      LIMIT ${limit}
    `)
    return result.rows.map(mapRowToUser)
  },
}

// Backward-compatible aliases while call sites migrate.
export const MemberRepository = UserRepository
export type Member = User
export type InsertMemberParams = InsertUserParams
