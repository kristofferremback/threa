import { PoolClient } from "pg"
import { sql } from "../db"

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
  workspace_id: string
  user_id: string
  role: string
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
  workspaceId: string
  userId: string
  role: "owner" | "admin" | "member"
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
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role as WorkspaceMember["role"],
    joinedAt: row.joined_at,
  }
}

export const WorkspaceRepository = {
  async findById(client: PoolClient, id: string): Promise<Workspace | null> {
    const result = await client.query<WorkspaceRow>(sql`
      SELECT id, name, slug, created_by, created_at, updated_at
      FROM workspaces WHERE id = ${id}
    `)
    return result.rows[0] ? mapRowToWorkspace(result.rows[0]) : null
  },

  async findBySlug(client: PoolClient, slug: string): Promise<Workspace | null> {
    const result = await client.query<WorkspaceRow>(sql`
      SELECT id, name, slug, created_by, created_at, updated_at
      FROM workspaces WHERE slug = ${slug}
    `)
    return result.rows[0] ? mapRowToWorkspace(result.rows[0]) : null
  },

  async list(client: PoolClient, filters: { userId: string }): Promise<Workspace[]> {
    const result = await client.query<WorkspaceRow>(sql`
      SELECT w.id, w.name, w.slug, w.created_by, w.created_at, w.updated_at
      FROM workspaces w
      JOIN workspace_members wm ON wm.workspace_id = w.id
      WHERE wm.user_id = ${filters.userId}
      ORDER BY w.created_at DESC
    `)
    return result.rows.map(mapRowToWorkspace)
  },

  async insert(client: PoolClient, params: InsertWorkspaceParams): Promise<Workspace> {
    const result = await client.query<WorkspaceRow>(sql`
      INSERT INTO workspaces (id, name, slug, created_by)
      VALUES (${params.id}, ${params.name}, ${params.slug}, ${params.createdBy})
      RETURNING id, name, slug, created_by, created_at, updated_at
    `)
    return mapRowToWorkspace(result.rows[0])
  },

  async addMember(
    client: PoolClient,
    workspaceId: string,
    userId: string,
    role: WorkspaceMember["role"] = "member",
  ): Promise<WorkspaceMember> {
    const result = await client.query<WorkspaceMemberRow>(sql`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES (${workspaceId}, ${userId}, ${role})
      RETURNING workspace_id, user_id, role, joined_at
    `)
    return mapRowToMember(result.rows[0])
  },

  async listMembers(client: PoolClient, workspaceId: string): Promise<WorkspaceMember[]> {
    const result = await client.query<WorkspaceMemberRow>(sql`
      SELECT workspace_id, user_id, role, joined_at
      FROM workspace_members
      WHERE workspace_id = ${workspaceId}
      ORDER BY joined_at
    `)
    return result.rows.map(mapRowToMember)
  },

  async isMember(client: PoolClient, workspaceId: string, userId: string): Promise<boolean> {
    const result = await client.query(sql`
      SELECT 1 FROM workspace_members
      WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
    `)
    return result.rows.length > 0
  },

  async slugExists(client: PoolClient, slug: string): Promise<boolean> {
    const result = await client.query(sql`
      SELECT 1 FROM workspaces WHERE slug = ${slug}
    `)
    return result.rows.length > 0
  },
}
