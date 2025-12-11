import { PoolClient } from "pg"
import { sql } from "../db"

// Internal row type (snake_case, not exported)
interface StreamRow {
  id: string
  workspace_id: string
  type: string
  name: string | null
  slug: string | null
  description: string | null
  visibility: string
  parent_stream_id: string | null
  parent_message_id: string | null
  root_stream_id: string | null
  companion_mode: string
  companion_persona_id: string | null
  created_by: string
  created_at: Date
  updated_at: Date
  archived_at: Date | null
}

// Domain type (camelCase, exported)
export type StreamType = "scratchpad" | "channel" | "dm" | "thread"
export type CompanionMode = "off" | "on" | "next_message_only"

export interface Stream {
  id: string
  workspaceId: string
  type: StreamType
  name: string | null
  slug: string | null
  description: string | null
  visibility: "public" | "private"
  parentStreamId: string | null
  parentMessageId: string | null
  rootStreamId: string | null
  companionMode: CompanionMode
  companionPersonaId: string | null
  createdBy: string
  createdAt: Date
  updatedAt: Date
  archivedAt: Date | null
}

export interface InsertStreamParams {
  id: string
  workspaceId: string
  type: StreamType
  name?: string
  slug?: string
  description?: string
  visibility?: "public" | "private"
  parentStreamId?: string
  parentMessageId?: string
  rootStreamId?: string
  companionMode?: CompanionMode
  companionPersonaId?: string
  createdBy: string
}

export interface UpdateStreamParams {
  name?: string
  description?: string
  companionMode?: CompanionMode
  companionPersonaId?: string | null
  archivedAt?: Date | null
}

function mapRowToStream(row: StreamRow): Stream {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type as StreamType,
    name: row.name,
    slug: row.slug,
    description: row.description,
    visibility: row.visibility as "public" | "private",
    parentStreamId: row.parent_stream_id,
    parentMessageId: row.parent_message_id,
    rootStreamId: row.root_stream_id,
    companionMode: row.companion_mode as CompanionMode,
    companionPersonaId: row.companion_persona_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  }
}

const SELECT_FIELDS = `
  id, workspace_id, type, name, slug, description, visibility,
  parent_stream_id, parent_message_id, root_stream_id,
  companion_mode, companion_persona_id,
  created_by, created_at, updated_at, archived_at
`

export const StreamRepository = {
  async findById(client: PoolClient, id: string): Promise<Stream | null> {
    const result = await client.query<StreamRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM streams WHERE id = ${id}`,
    )
    return result.rows[0] ? mapRowToStream(result.rows[0]) : null
  },

  async findByWorkspaceAndType(
    client: PoolClient,
    workspaceId: string,
    type: StreamType,
  ): Promise<Stream[]> {
    const result = await client.query<StreamRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM streams
          WHERE workspace_id = ${workspaceId}
            AND type = ${type}
            AND archived_at IS NULL
          ORDER BY created_at DESC`,
    )
    return result.rows.map(mapRowToStream)
  },

  async findByWorkspace(client: PoolClient, workspaceId: string): Promise<Stream[]> {
    const result = await client.query<StreamRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM streams
          WHERE workspace_id = ${workspaceId}
            AND archived_at IS NULL
          ORDER BY created_at DESC`,
    )
    return result.rows.map(mapRowToStream)
  },

  async findByParentStream(client: PoolClient, parentStreamId: string): Promise<Stream[]> {
    const result = await client.query<StreamRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM streams
          WHERE parent_stream_id = ${parentStreamId}
            AND archived_at IS NULL
          ORDER BY created_at DESC`,
    )
    return result.rows.map(mapRowToStream)
  },

  async insert(client: PoolClient, params: InsertStreamParams): Promise<Stream> {
    const result = await client.query<StreamRow>(sql`
      INSERT INTO streams (
        id, workspace_id, type, name, slug, description, visibility,
        parent_stream_id, parent_message_id, root_stream_id,
        companion_mode, companion_persona_id, created_by
      ) VALUES (
        ${params.id},
        ${params.workspaceId},
        ${params.type},
        ${params.name ?? null},
        ${params.slug ?? null},
        ${params.description ?? null},
        ${params.visibility ?? "private"},
        ${params.parentStreamId ?? null},
        ${params.parentMessageId ?? null},
        ${params.rootStreamId ?? null},
        ${params.companionMode ?? "off"},
        ${params.companionPersonaId ?? null},
        ${params.createdBy}
      )
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return mapRowToStream(result.rows[0])
  },

  async update(
    client: PoolClient,
    id: string,
    params: UpdateStreamParams,
  ): Promise<Stream | null> {
    const sets: string[] = []
    const values: unknown[] = []
    let paramIndex = 1

    if (params.name !== undefined) {
      sets.push(`name = $${paramIndex++}`)
      values.push(params.name)
    }
    if (params.description !== undefined) {
      sets.push(`description = $${paramIndex++}`)
      values.push(params.description)
    }
    if (params.companionMode !== undefined) {
      sets.push(`companion_mode = $${paramIndex++}`)
      values.push(params.companionMode)
    }
    if (params.companionPersonaId !== undefined) {
      sets.push(`companion_persona_id = $${paramIndex++}`)
      values.push(params.companionPersonaId)
    }
    if (params.archivedAt !== undefined) {
      sets.push(`archived_at = $${paramIndex++}`)
      values.push(params.archivedAt)
    }

    if (sets.length === 0) return this.findById(client, id)

    sets.push(`updated_at = NOW()`)
    values.push(id)

    const query = `
      UPDATE streams SET ${sets.join(", ")}
      WHERE id = $${paramIndex}
      RETURNING ${SELECT_FIELDS}
    `
    const result = await client.query<StreamRow>(query, values)
    return result.rows[0] ? mapRowToStream(result.rows[0]) : null
  },

  async slugExistsInWorkspace(
    client: PoolClient,
    workspaceId: string,
    slug: string,
  ): Promise<boolean> {
    const result = await client.query(sql`
      SELECT 1 FROM streams
      WHERE workspace_id = ${workspaceId} AND slug = ${slug}
    `)
    return result.rows.length > 0
  },
}
