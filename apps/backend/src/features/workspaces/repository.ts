import type { Querier } from "../../db"
import { sql } from "../../db"

// Internal row type (snake_case, not exported)
interface WorkspaceRow {
  id: string
  name: string
  slug: string
  created_by: string
  created_at: Date
  updated_at: Date
}

interface WorkspaceMemberRow {
  id: string
  workspace_id: string
  user_id: string
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

// Domain types (camelCase, exported)
export interface Workspace {
  id: string
  name: string
  slug: string
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export interface WorkspaceMember {
  id: string
  workspaceId: string
  userId: string
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

export interface InsertWorkspaceParams {
  id: string
  name: string
  slug: string
  createdBy: string
}

function mapRowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapRowToMember(row: WorkspaceMemberRow): WorkspaceMember {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role as WorkspaceMember["role"],
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

export const WorkspaceRepository = {
  async findById(db: Querier, id: string): Promise<Workspace | null> {
    const result = await db.query<WorkspaceRow>(sql`
      SELECT id, name, slug, created_by, created_at, updated_at
      FROM workspaces WHERE id = ${id}
    `)
    return result.rows[0] ? mapRowToWorkspace(result.rows[0]) : null
  },

  async findBySlug(db: Querier, slug: string): Promise<Workspace | null> {
    const result = await db.query<WorkspaceRow>(sql`
      SELECT id, name, slug, created_by, created_at, updated_at
      FROM workspaces WHERE slug = ${slug}
    `)
    return result.rows[0] ? mapRowToWorkspace(result.rows[0]) : null
  },

  async list(db: Querier, filters: { userId: string }): Promise<Workspace[]> {
    const result = await db.query<WorkspaceRow>(sql`
      SELECT w.id, w.name, w.slug, w.created_by, w.created_at, w.updated_at
      FROM workspaces w
      JOIN workspace_members wm ON wm.workspace_id = w.id
      WHERE wm.user_id = ${filters.userId}
      ORDER BY w.created_at DESC
    `)
    return result.rows.map(mapRowToWorkspace)
  },

  async insert(db: Querier, params: InsertWorkspaceParams): Promise<Workspace> {
    const result = await db.query<WorkspaceRow>(sql`
      INSERT INTO workspaces (id, name, slug, created_by)
      VALUES (${params.id}, ${params.name}, ${params.slug}, ${params.createdBy})
      RETURNING id, name, slug, created_by, created_at, updated_at
    `)
    return mapRowToWorkspace(result.rows[0])
  },

  async addMember(
    db: Querier,
    params: {
      id: string
      workspaceId: string
      userId: string
      slug: string
      name: string
      role?: WorkspaceMember["role"]
      timezone?: string
      locale?: string
      setupCompleted?: boolean
    }
  ): Promise<WorkspaceMember> {
    const result = await db.query<WorkspaceMemberRow>(sql`
      INSERT INTO workspace_members (id, workspace_id, user_id, role, slug, name, timezone, locale, setup_completed)
      VALUES (${params.id}, ${params.workspaceId}, ${params.userId}, ${params.role ?? "member"}, ${params.slug}, ${params.name}, ${params.timezone ?? null}, ${params.locale ?? null}, ${params.setupCompleted ?? true})
      RETURNING id, workspace_id, user_id, role, slug, name, description, avatar_url, timezone, locale, setup_completed, joined_at
    `)
    return mapRowToMember(result.rows[0])
  },

  async removeMember(db: Querier, workspaceId: string, userId: string): Promise<void> {
    await db.query(sql`
      DELETE FROM workspace_members
      WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
    `)
  },

  async removeMemberById(db: Querier, workspaceId: string, memberId: string): Promise<void> {
    await db.query(sql`
      DELETE FROM workspace_members
      WHERE workspace_id = ${workspaceId} AND id = ${memberId}
    `)
  },

  async listMembers(db: Querier, workspaceId: string): Promise<WorkspaceMember[]> {
    const result = await db.query<WorkspaceMemberRow>(sql`
      SELECT id, workspace_id, user_id, role, slug, name, description, avatar_url, timezone, locale, setup_completed, joined_at
      FROM workspace_members
      WHERE workspace_id = ${workspaceId}
      ORDER BY joined_at
    `)
    return result.rows.map(mapRowToMember)
  },

  async isMember(db: Querier, workspaceId: string, userId: string): Promise<boolean> {
    const result = await db.query(sql`
      SELECT 1 FROM workspace_members
      WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
    `)
    return result.rows.length > 0
  },

  async findMemberUserIds(db: Querier, workspaceId: string, userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set()

    const result = await db.query<{ user_id: string }>(sql`
      SELECT user_id FROM workspace_members
      WHERE workspace_id = ${workspaceId} AND user_id = ANY(${userIds})
    `)
    return new Set(result.rows.map((r) => r.user_id))
  },

  async slugExists(db: Querier, slug: string): Promise<boolean> {
    const result = await db.query(sql`
      SELECT 1 FROM workspaces WHERE slug = ${slug}
    `)
    return result.rows.length > 0
  },

  async memberSlugExists(db: Querier, workspaceId: string, slug: string): Promise<boolean> {
    const result = await db.query(sql`
      SELECT 1 FROM workspace_members WHERE workspace_id = ${workspaceId} AND slug = ${slug}
    `)
    return result.rows.length > 0
  },

  async updateMember(
    db: Querier,
    memberId: string,
    params: {
      slug?: string
      name?: string
      description?: string | null
      avatarUrl?: string | null
      timezone?: string
      locale?: string
      setupCompleted?: boolean
    }
  ): Promise<WorkspaceMember | null> {
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

    values.push(memberId)
    let whereClause = `WHERE id = $${paramIndex}`
    if (params.setupCompleted === true) {
      whereClause += ` AND setup_completed = false`
    }
    const query = `
      UPDATE workspace_members SET ${sets.join(", ")}
      ${whereClause}
      RETURNING id, workspace_id, user_id, role, slug, name, description, avatar_url, timezone, locale, setup_completed, joined_at
    `
    const result = await db.query<WorkspaceMemberRow>(query, values)
    return result.rows[0] ? mapRowToMember(result.rows[0]) : null
  },

  async updateMemberAvatarIfLatestUpload(
    db: Querier,
    memberId: string,
    avatarUploadId: string,
    avatarUrl: string
  ): Promise<WorkspaceMember | null> {
    const result = await db.query<WorkspaceMemberRow>(sql`
      UPDATE workspace_members SET avatar_url = ${avatarUrl}
      WHERE id = ${memberId}
        AND ${avatarUploadId} = (
          SELECT id FROM avatar_uploads
          WHERE member_id = ${memberId}
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        )
      RETURNING id, workspace_id, user_id, role, slug, name, description, avatar_url, timezone, locale, setup_completed, joined_at
    `)
    return result.rows[0] ? mapRowToMember(result.rows[0]) : null
  },

  async getWorkosOrganizationId(db: Querier, workspaceId: string): Promise<string | null> {
    const result = await db.query<{ workos_organization_id: string | null }>(sql`
      SELECT workos_organization_id FROM workspaces WHERE id = ${workspaceId}
    `)
    return result.rows[0]?.workos_organization_id ?? null
  },

  async setWorkosOrganizationId(db: Querier, workspaceId: string, orgId: string): Promise<void> {
    await db.query(sql`
      UPDATE workspaces SET workos_organization_id = ${orgId}
      WHERE id = ${workspaceId} AND workos_organization_id IS NULL
    `)
  },

  async findMemberByUserId(db: Querier, workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
    const result = await db.query<WorkspaceMemberRow>(sql`
      SELECT id, workspace_id, user_id, role, slug, name, description, avatar_url, timezone, locale, setup_completed, joined_at
      FROM workspace_members
      WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
    `)
    return result.rows[0] ? mapRowToMember(result.rows[0]) : null
  },
}
