import { Pool } from "pg"
import { withTransaction } from "../lib/db"
import { logger } from "../lib/logger"
import { aiPersonaId } from "../lib/id"

/**
 * Available tools that can be enabled/disabled per persona.
 * These correspond to the tools defined in ariadne/tools.ts
 */
export const AVAILABLE_TOOLS = [
  "search_memos",
  "search_messages",
  "get_stream_context",
  "get_thread_history",
  "web_search",
  "fetch_url",
] as const

export type ToolName = (typeof AVAILABLE_TOOLS)[number]

/**
 * Agent persona configuration.
 * Inspired by Anthropic's Agent Skills with progressive disclosure:
 * - Level 1 (Metadata): name, slug, description, avatar_emoji
 * - Level 2 (Instructions): system_prompt, model config
 * - Level 3 (Resources): accessed via enabled tools
 */
export interface AgentPersona {
  id: string
  workspaceId: string
  name: string
  slug: string
  description: string
  avatarEmoji: string | null
  systemPrompt: string
  enabledTools: ToolName[] | null
  model: string
  temperature: number
  maxTokens: number
  allowedStreamIds: string[] | null
  isDefault: boolean
  isActive: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

/**
 * Minimal persona info for UI display (Level 1 metadata).
 */
export interface PersonaMetadata {
  id: string
  name: string
  slug: string
  description: string
  avatarEmoji: string | null
  isDefault: boolean
  isActive: boolean
}

/**
 * Input for creating a new persona.
 */
export interface CreatePersonaInput {
  name: string
  slug: string
  description: string
  avatarEmoji?: string
  systemPrompt: string
  enabledTools?: ToolName[]
  model?: string
  temperature?: number
  maxTokens?: number
  allowedStreamIds?: string[]
  isDefault?: boolean
}

/**
 * Input for updating an existing persona.
 */
export interface UpdatePersonaInput {
  name?: string
  slug?: string
  description?: string
  avatarEmoji?: string | null
  systemPrompt?: string
  enabledTools?: ToolName[] | null
  model?: string
  temperature?: number
  maxTokens?: number
  allowedStreamIds?: string[] | null
  isDefault?: boolean
  isActive?: boolean
}

export class PersonaService {
  constructor(private pool: Pool) {}

  /**
   * List all personas for a workspace (Level 1 metadata for UI).
   * Returns both active and inactive personas - UI should show inactive ones greyed out.
   */
  async listPersonas(workspaceId: string): Promise<PersonaMetadata[]> {
    const result = await this.pool.query<{
      id: string
      name: string
      slug: string
      description: string
      avatar_emoji: string | null
      is_default: boolean
      is_active: boolean
    }>(
      `SELECT id, name, slug, description, avatar_emoji, is_default, is_active
       FROM agent_personas
       WHERE workspace_id = $1
       ORDER BY is_active DESC, is_default DESC, name ASC`,
      [workspaceId],
    )

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      avatarEmoji: row.avatar_emoji,
      isDefault: row.is_default,
      isActive: row.is_active,
    }))
  }

  /**
   * Get a persona by ID (full details for invocation).
   */
  async getPersona(personaId: string): Promise<AgentPersona | null> {
    const result = await this.pool.query<DbPersonaRow>(
      `SELECT * FROM agent_personas WHERE id = $1`,
      [personaId],
    )

    if (result.rows.length === 0) {
      return null
    }

    return this.mapDbRow(result.rows[0])
  }

  /**
   * Get a persona by slug within a workspace.
   */
  async getPersonaBySlug(workspaceId: string, slug: string): Promise<AgentPersona | null> {
    const result = await this.pool.query<DbPersonaRow>(
      `SELECT * FROM agent_personas
       WHERE workspace_id = $1 AND slug = $2 AND is_active = TRUE`,
      [workspaceId, slug],
    )

    if (result.rows.length === 0) {
      return null
    }

    return this.mapDbRow(result.rows[0])
  }

  /**
   * Get the default persona for a workspace.
   */
  async getDefaultPersona(workspaceId: string): Promise<AgentPersona | null> {
    const result = await this.pool.query<DbPersonaRow>(
      `SELECT * FROM agent_personas
       WHERE workspace_id = $1 AND is_default = TRUE AND is_active = TRUE`,
      [workspaceId],
    )

    if (result.rows.length === 0) {
      return null
    }

    return this.mapDbRow(result.rows[0])
  }

  /**
   * Create a new persona.
   */
  async createPersona(
    workspaceId: string,
    createdBy: string,
    input: CreatePersonaInput,
  ): Promise<AgentPersona> {
    const persona = await withTransaction(this.pool, async (client) => {
      const id = aiPersonaId()

      // If this is marked as default, unset any existing default
      if (input.isDefault) {
        await client.query(
          `UPDATE agent_personas SET is_default = FALSE WHERE workspace_id = $1 AND is_default = TRUE`,
          [workspaceId],
        )
      }

      const result = await client.query<DbPersonaRow>(
        `INSERT INTO agent_personas (
          id, workspace_id, name, slug, description, avatar_emoji,
          system_prompt, enabled_tools, model, temperature, max_tokens,
          allowed_stream_ids, is_default, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *`,
        [
          id,
          workspaceId,
          input.name,
          input.slug,
          input.description,
          input.avatarEmoji || null,
          input.systemPrompt,
          input.enabledTools || null,
          input.model || "anthropic:claude-haiku-4-5-20251001",
          input.temperature ?? 0.7,
          input.maxTokens ?? 2048,
          input.allowedStreamIds || null,
          input.isDefault || false,
          createdBy,
        ],
      )

      logger.info(
        { personaId: id, workspaceId, name: input.name, slug: input.slug },
        "Created agent persona",
      )

      return this.mapDbRow(result.rows[0])
    })

    return persona
  }

  /**
   * Update an existing persona.
   */
  async updatePersona(personaId: string, input: UpdatePersonaInput): Promise<AgentPersona | null> {
    return withTransaction(this.pool, async (client) => {
      // Get current persona to find workspace_id
      const current = await client.query<{ workspace_id: string }>(
        `SELECT workspace_id FROM agent_personas WHERE id = $1`,
        [personaId],
      )

      if (current.rows.length === 0) {
        return null
      }

      const workspaceId = current.rows[0].workspace_id

      // If setting as default, unset any existing default
      if (input.isDefault) {
        await client.query(
          `UPDATE agent_personas SET is_default = FALSE WHERE workspace_id = $1 AND is_default = TRUE AND id != $2`,
          [workspaceId, personaId],
        )
      }

      // Build dynamic update query
      const updates: string[] = []
      const values: unknown[] = []
      let paramIndex = 1

      if (input.name !== undefined) {
        updates.push(`name = $${paramIndex++}`)
        values.push(input.name)
      }
      if (input.slug !== undefined) {
        updates.push(`slug = $${paramIndex++}`)
        values.push(input.slug)
      }
      if (input.description !== undefined) {
        updates.push(`description = $${paramIndex++}`)
        values.push(input.description)
      }
      if (input.avatarEmoji !== undefined) {
        updates.push(`avatar_emoji = $${paramIndex++}`)
        values.push(input.avatarEmoji)
      }
      if (input.systemPrompt !== undefined) {
        updates.push(`system_prompt = $${paramIndex++}`)
        values.push(input.systemPrompt)
      }
      if (input.enabledTools !== undefined) {
        updates.push(`enabled_tools = $${paramIndex++}`)
        values.push(input.enabledTools)
      }
      if (input.model !== undefined) {
        updates.push(`model = $${paramIndex++}`)
        values.push(input.model)
      }
      if (input.temperature !== undefined) {
        updates.push(`temperature = $${paramIndex++}`)
        values.push(input.temperature)
      }
      if (input.maxTokens !== undefined) {
        updates.push(`max_tokens = $${paramIndex++}`)
        values.push(input.maxTokens)
      }
      if (input.allowedStreamIds !== undefined) {
        updates.push(`allowed_stream_ids = $${paramIndex++}`)
        values.push(input.allowedStreamIds)
      }
      if (input.isDefault !== undefined) {
        updates.push(`is_default = $${paramIndex++}`)
        values.push(input.isDefault)
      }
      if (input.isActive !== undefined) {
        updates.push(`is_active = $${paramIndex++}`)
        values.push(input.isActive)
      }

      if (updates.length === 0) {
        // No updates - fetch and return current persona
        const result = await client.query<DbPersonaRow>(
          `SELECT * FROM agent_personas WHERE id = $1`,
          [personaId],
        )
        return result.rows[0] ? this.mapDbRow(result.rows[0]) : null
      }

      values.push(personaId)
      const result = await client.query<DbPersonaRow>(
        `UPDATE agent_personas SET ${updates.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
        values,
      )

      logger.info({ personaId, updates: Object.keys(input) }, "Updated agent persona")

      return this.mapDbRow(result.rows[0])
    })
  }

  /**
   * Soft delete a persona (set is_active = false).
   */
  async deletePersona(personaId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE agent_personas SET is_active = FALSE WHERE id = $1 AND is_default = FALSE`,
      [personaId],
    )

    if (result.rowCount === 0) {
      logger.warn({ personaId }, "Cannot delete persona (not found or is default)")
      return false
    }

    logger.info({ personaId }, "Deleted agent persona")
    return true
  }

  /**
   * Resolve a persona mention to its full configuration.
   * Used when @persona is mentioned in a message.
   */
  async resolvePersonaMention(
    workspaceId: string,
    mention: string,
  ): Promise<AgentPersona | null> {
    // Remove @ prefix if present
    const slug = mention.startsWith("@") ? mention.slice(1) : mention
    return this.getPersonaBySlug(workspaceId, slug)
  }

  /**
   * Check if a persona is allowed in a given stream.
   */
  async isPersonaAllowedInStream(personaId: string, streamId: string): Promise<boolean> {
    const result = await this.pool.query<{ allowed_stream_ids: string[] | null }>(
      `SELECT allowed_stream_ids FROM agent_personas WHERE id = $1 AND is_active = TRUE`,
      [personaId],
    )

    if (result.rows.length === 0) {
      return false
    }

    const allowedStreamIds = result.rows[0].allowed_stream_ids

    // NULL means allowed in all streams
    if (allowedStreamIds === null) {
      return true
    }

    return allowedStreamIds.includes(streamId)
  }

  /**
   * Map database row to AgentPersona type.
   */
  private mapDbRow(row: DbPersonaRow): AgentPersona {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      avatarEmoji: row.avatar_emoji,
      systemPrompt: row.system_prompt,
      enabledTools: row.enabled_tools as ToolName[] | null,
      model: row.model,
      temperature: row.temperature,
      maxTokens: row.max_tokens,
      allowedStreamIds: row.allowed_stream_ids,
      isDefault: row.is_default,
      isActive: row.is_active,
      createdBy: row.created_by,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }
  }
}

/**
 * Database row shape for agent_personas table.
 */
interface DbPersonaRow {
  id: string
  workspace_id: string
  name: string
  slug: string
  description: string
  avatar_emoji: string | null
  system_prompt: string
  enabled_tools: string[] | null
  model: string
  temperature: number
  max_tokens: number
  allowed_stream_ids: string[] | null
  is_default: boolean
  is_active: boolean
  created_by: string
  created_at: Date
  updated_at: Date
}
