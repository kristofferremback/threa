import { sql, type Querier } from "../../db"

interface AgentConfigOverrideRow {
  agent_id: string
  patch: unknown
}

/**
 * A row from `agent_config_overrides` (JSONB is opaque in the DB; validate/apply via
 * `applyBuiltInAgentPatch` in `built-in-agents.ts`).
 */
export interface AgentConfigOverride {
  agentId: string
  patch: unknown
}

/**
 * Read helpers for `agent_config_overrides`. All methods filter to `status = 'active'`.
 */
export const AgentConfigOverrideRepository = {
  /**
   * Fetch the active override for a single built-in `persona_system_*` id in a workspace, if any.
   */
  async findActiveByWorkspaceAndAgent(
    db: Querier,
    workspaceId: string,
    agentId: string
  ): Promise<AgentConfigOverride | null> {
    const result = await db.query<AgentConfigOverrideRow>(sql`
      SELECT agent_id, patch
      FROM agent_config_overrides
      WHERE workspace_id = ${workspaceId}
        AND agent_id = ${agentId}
        AND status = 'active'
    `)

    const row = result.rows[0]
    return row ? { agentId: row.agent_id, patch: row.patch } : null
  },

  /**
   * List all active overrides for a workspace (used to batch-apply built-in patches).
   */
  async listActiveByWorkspace(db: Querier, workspaceId: string): Promise<AgentConfigOverride[]> {
    const result = await db.query<AgentConfigOverrideRow>(sql`
      SELECT agent_id, patch
      FROM agent_config_overrides
      WHERE workspace_id = ${workspaceId}
        AND status = 'active'
    `)

    return result.rows.map((row) => ({ agentId: row.agent_id, patch: row.patch }))
  },
}
