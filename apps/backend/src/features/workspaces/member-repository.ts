import type { Querier } from "../../db"
import { sql } from "../../db"

interface MemberRow {
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

export interface Member {
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

export interface InsertMemberParams {
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

function mapRowToMember(row: MemberRow): Member {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workosUserId: row.workos_user_id,
    email: row.email,
    role: row.role as Member["role"],
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

export const MemberRepository = {
  async findById(db: Querier, id: string): Promise<Member | null> {
    const result = await db.query<MemberRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)}
      FROM workspace_members wm
      WHERE wm.id = ${id}
    `)
    return result.rows[0] ? mapRowToMember(result.rows[0]) : null
  },

  async findByWorkosUserIdInWorkspace(db: Querier, workspaceId: string, workosUserId: string): Promise<Member | null> {
    const result = await db.query<MemberRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)}
      FROM workspace_members wm
      WHERE wm.workspace_id = ${workspaceId} AND wm.workos_user_id = ${workosUserId}
    `)
    return result.rows[0] ? mapRowToMember(result.rows[0]) : null
  },

  async findBySlug(db: Querier, workspaceId: string, slug: string): Promise<Member | null> {
    const result = await db.query<MemberRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)}
      FROM workspace_members wm
      WHERE wm.workspace_id = ${workspaceId} AND wm.slug = ${slug}
    `)
    return result.rows[0] ? mapRowToMember(result.rows[0]) : null
  },

  async findBySlugs(db: Querier, workspaceId: string, slugs: string[]): Promise<Member[]> {
    if (slugs.length === 0) return []

    const result = await db.query<MemberRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)}
      FROM workspace_members wm
      WHERE wm.workspace_id = ${workspaceId} AND wm.slug = ANY(${slugs})
    `)
    return result.rows.map(mapRowToMember)
  },

  async findByIds(db: Querier, ids: string[]): Promise<Member[]> {
    if (ids.length === 0) return []

    const result = await db.query<MemberRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)}
      FROM workspace_members wm
      WHERE wm.id = ANY(${ids})
    `)
    return result.rows.map(mapRowToMember)
  },

  async listByWorkspace(db: Querier, workspaceId: string): Promise<Member[]> {
    const result = await db.query<MemberRow>(sql`
      SELECT ${sql.raw(SELECT_FIELDS)}
      FROM workspace_members wm
      WHERE wm.workspace_id = ${workspaceId}
      ORDER BY wm.joined_at
    `)
    return result.rows.map(mapRowToMember)
  },

  async insert(db: Querier, params: InsertMemberParams): Promise<Member> {
    await db.query(sql`
      INSERT INTO workspace_members (id, workspace_id, workos_user_id, email, role, slug, name)
      VALUES (${params.id}, ${params.workspaceId}, ${params.workosUserId}, ${params.email}, ${params.role}, ${params.slug}, ${params.name})
    `)
    const member = await this.findById(db, params.id)
    if (!member) throw new Error("Failed to insert member")
    return member
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
   * Search for members in a workspace by name, email, or slug.
   * Uses pg_trgm trigram similarity for fuzzy matching (handles typos),
   * combined with ILIKE for exact substring matches.
   */
  async searchByNameOrSlug(db: Querier, workspaceId: string, query: string, limit: number): Promise<Member[]> {
    const pattern = `%${query}%`
    const result = await db.query<MemberRow>(sql`
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
    return result.rows.map(mapRowToMember)
  },
}
