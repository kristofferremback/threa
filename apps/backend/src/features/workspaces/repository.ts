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
  timezone: string | null
  locale: string | null
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
  timezone: string | null
  locale: string | null
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
    timezone: row.timezone,
    locale: row.locale,
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
      role?: WorkspaceMember["role"]
      timezone?: string
      locale?: string
    }
  ): Promise<WorkspaceMember> {
    const result = await db.query<WorkspaceMemberRow>(sql`
      INSERT INTO workspace_members (id, workspace_id, user_id, role, slug, timezone, locale)
      VALUES (${params.id}, ${params.workspaceId}, ${params.userId}, ${params.role ?? "member"}, ${params.slug}, ${params.timezone ?? null}, ${params.locale ?? null})
      RETURNING id, workspace_id, user_id, role, slug, timezone, locale, joined_at
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
      SELECT id, workspace_id, user_id, role, slug, timezone, locale, joined_at
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
}
