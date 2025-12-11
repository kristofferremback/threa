import { PoolClient } from "pg"
import { sql } from "../db"

interface PersonaRow {
  id: string
  workspace_id: string | null
  slug: string
  name: string
  description: string | null
  avatar_emoji: string | null
  system_prompt: string | null
  model: string
  temperature: string | null
  max_tokens: number | null
  enabled_tools: string[] | null
  expertise_triggers: string | null
  managed_by: string
  status: string
  created_at: Date
  updated_at: Date
}

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
  expertiseTriggers: string | null
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
    temperature: row.temperature ? parseFloat(row.temperature) : null,
    maxTokens: row.max_tokens,
    enabledTools: row.enabled_tools,
    expertiseTriggers: row.expertise_triggers,
    managedBy: row.managed_by as "system" | "workspace",
    status: row.status as "active" | "disabled" | "archived",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const SELECT_FIELDS = `
  id, workspace_id, slug, name, description, avatar_emoji,
  system_prompt, model, temperature, max_tokens, enabled_tools,
  expertise_triggers, managed_by, status, created_at, updated_at
`

export const PersonaRepository = {
  async findById(client: PoolClient, id: string): Promise<Persona | null> {
    const result = await client.query<PersonaRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM personas WHERE id = ${id}`,
    )
    return result.rows[0] ? mapRowToPersona(result.rows[0]) : null
  },

  async findBySlug(
    client: PoolClient,
    workspaceId: string | null,
    slug: string,
  ): Promise<Persona | null> {
    // Try workspace-scoped first, then system
    if (workspaceId) {
      const result = await client.query<PersonaRow>(
        sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM personas
            WHERE workspace_id = ${workspaceId} AND slug = ${slug} AND status = 'active'`,
      )
      if (result.rows[0]) return mapRowToPersona(result.rows[0])
    }

    // Fall back to system persona
    const result = await client.query<PersonaRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM personas
          WHERE workspace_id IS NULL AND slug = ${slug} AND status = 'active'`,
    )
    return result.rows[0] ? mapRowToPersona(result.rows[0]) : null
  },

  async findSystemDefault(client: PoolClient): Promise<Persona | null> {
    // Get the default system persona (Ariadne)
    const result = await client.query<PersonaRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM personas
          WHERE workspace_id IS NULL AND managed_by = 'system' AND status = 'active'
          ORDER BY created_at ASC
          LIMIT 1`,
    )
    return result.rows[0] ? mapRowToPersona(result.rows[0]) : null
  },

  async findByWorkspace(client: PoolClient, workspaceId: string): Promise<Persona[]> {
    const result = await client.query<PersonaRow>(
      sql`SELECT ${sql.raw(SELECT_FIELDS)} FROM personas
          WHERE (workspace_id = ${workspaceId} OR workspace_id IS NULL)
            AND status = 'active'
          ORDER BY managed_by DESC, name ASC`,
    )
    return result.rows.map(mapRowToPersona)
  },
}
