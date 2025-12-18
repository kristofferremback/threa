import type { PoolClient } from "pg"
import { sql } from "../db"

// Internal row type (snake_case)
interface PersonaRow {
  id: string
  workspace_id: string | null
  slug: string
  name: string
  description: string | null
  avatar_emoji: string | null
  system_prompt: string | null
  model: string
  temperature: number | null
  max_tokens: number | null
  enabled_tools: string[] | null
  managed_by: string
  status: string
  created_at: Date
  updated_at: Date
}

// Domain type (camelCase)
export interface Persona {
  id: string
  workspaceId: string | null
  slug: string
  name: string
  description: string | null
  avatarEmoji: string | null
  systemPrompt: string | null
  model: string
  temperature: number | null
  maxTokens: number | null
  enabledTools: string[] | null
  managedBy: "system" | "workspace"
  status: "active" | "disabled" | "archived"
  createdAt: Date
  updatedAt: Date
}

function mapRowToPersona(row: PersonaRow): Persona {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    avatarEmoji: row.avatar_emoji,
    systemPrompt: row.system_prompt,
    model: row.model,
    temperature: row.temperature ? Number(row.temperature) : null,
    maxTokens: row.max_tokens,
    enabledTools: row.enabled_tools,
    managedBy: row.managed_by as "system" | "workspace",
    status: row.status as "active" | "disabled" | "archived",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const SELECT_FIELDS = `
  id, workspace_id, slug, name, description, avatar_emoji,
  system_prompt, model, temperature, max_tokens, enabled_tools,
  managed_by, status, created_at, updated_at
`

export const PersonaRepository = {
  async findById(client: PoolClient, id: string): Promise<Persona | null> {
    const result = await client.query<PersonaRow>(
      sql`
        SELECT ${sql.raw(SELECT_FIELDS)}
        FROM personas
        WHERE id = ${id}
      `
    )
    return result.rows[0] ? mapRowToPersona(result.rows[0]) : null
  },

  async findBySlug(client: PoolClient, slug: string, workspaceId?: string | null): Promise<Persona | null> {
    // System personas have null workspace_id
    if (workspaceId === null || workspaceId === undefined) {
      const result = await client.query<PersonaRow>(
        sql`
          SELECT ${sql.raw(SELECT_FIELDS)}
          FROM personas
          WHERE slug = ${slug} AND workspace_id IS NULL
        `
      )
      return result.rows[0] ? mapRowToPersona(result.rows[0]) : null
    }

    // Look for workspace-specific first, fall back to system
    const result = await client.query<PersonaRow>(
      sql`
        SELECT ${sql.raw(SELECT_FIELDS)}
        FROM personas
        WHERE slug = ${slug} AND (workspace_id = ${workspaceId} OR workspace_id IS NULL)
        ORDER BY workspace_id NULLS LAST
        LIMIT 1
      `
    )
    return result.rows[0] ? mapRowToPersona(result.rows[0]) : null
  },

  /**
   * Get the default system persona (Ariadne).
   */
  async getSystemDefault(client: PoolClient): Promise<Persona | null> {
    const result = await client.query<PersonaRow>(
      sql`
        SELECT ${sql.raw(SELECT_FIELDS)}
        FROM personas
        WHERE managed_by = 'system' AND status = 'active'
        ORDER BY created_at ASC
        LIMIT 1
      `
    )
    return result.rows[0] ? mapRowToPersona(result.rows[0]) : null
  },
}
