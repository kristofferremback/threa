import { sql, type Querier } from "../../db"

interface AgentConfigOverrideRow {
  agent_id: string
  patch: unknown
}

export interface AgentConfigOverride {
  agentId: string
  patch: unknown
}

export const AgentConfigOverrideRepository = {
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
