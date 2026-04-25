import type { Querier } from "../../../db"
import { sql } from "../../../db"
import { generalResearchRunId, generalResearchStepId } from "../../../lib/id"
import type { SourceItem } from "@threa/types"

export const GeneralResearchRunStatuses = {
  PENDING: "pending",
  RUNNING: "running",
  NEEDS_CLARIFICATION: "needs_clarification",
  COMPLETED: "completed",
  PARTIAL: "partial",
  FAILED: "failed",
} as const
export type GeneralResearchRunStatus = (typeof GeneralResearchRunStatuses)[keyof typeof GeneralResearchRunStatuses]

export const GeneralResearchStepStatuses = {
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
} as const
export type GeneralResearchStepStatus = (typeof GeneralResearchStepStatuses)[keyof typeof GeneralResearchStepStatuses]

interface GeneralResearchRunRow {
  id: string
  workspace_id: string
  agent_session_id: string
  invocation_key: string
  tool_call_id: string | null
  query: string
  input_hash: string
  status: string
  current_phase: string
  lease_owner: string | null
  lease_expires_at: Date | null
  attempt: number
  partial_reason: string | null
  final_answer: string | null
  report_storage_key: string | null
  output_json: unknown
  sources_json: unknown
  created_at: Date
  updated_at: Date
  completed_at: Date | null
}

interface GeneralResearchStepRow {
  id: string
  workspace_id: string
  run_id: string
  step_key: string
  phase: string
  status: string
  attempt: number
  input_json: unknown
  output_json: unknown
  sources_json: unknown
  error: string | null
  started_at: Date
  completed_at: Date | null
  updated_at: Date
}

export interface GeneralResearchRun {
  id: string
  workspaceId: string
  agentSessionId: string
  invocationKey: string
  toolCallId: string | null
  query: string
  inputHash: string
  status: GeneralResearchRunStatus
  currentPhase: string
  leaseOwner: string | null
  leaseExpiresAt: Date | null
  attempt: number
  partialReason: string | null
  finalAnswer: string | null
  reportStorageKey: string | null
  outputJson: unknown
  sources: SourceItem[]
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
}

export interface GeneralResearchStep {
  id: string
  workspaceId: string
  runId: string
  stepKey: string
  phase: string
  status: GeneralResearchStepStatus
  attempt: number
  inputJson: unknown
  outputJson: unknown
  sources: SourceItem[]
  error: string | null
  startedAt: Date
  completedAt: Date | null
  updatedAt: Date
}

const RUN_SELECT_FIELDS = sql.raw(`
  id, workspace_id, agent_session_id, invocation_key, tool_call_id, query,
  input_hash, status, current_phase, lease_owner, lease_expires_at, attempt,
  partial_reason, final_answer, report_storage_key, output_json, sources_json,
  created_at, updated_at, completed_at
`)

const STEP_SELECT_FIELDS = sql.raw(`
  id, workspace_id, run_id, step_key, phase, status, attempt, input_json,
  output_json, sources_json, error, started_at, completed_at, updated_at
`)

function mapSources(value: unknown): SourceItem[] {
  return Array.isArray(value) ? (value as SourceItem[]) : []
}

function mapRun(row: GeneralResearchRunRow): GeneralResearchRun {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    agentSessionId: row.agent_session_id,
    invocationKey: row.invocation_key,
    toolCallId: row.tool_call_id,
    query: row.query,
    inputHash: row.input_hash,
    status: row.status as GeneralResearchRunStatus,
    currentPhase: row.current_phase,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    attempt: row.attempt,
    partialReason: row.partial_reason,
    finalAnswer: row.final_answer,
    reportStorageKey: row.report_storage_key,
    outputJson: row.output_json,
    sources: mapSources(row.sources_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}

function mapStep(row: GeneralResearchStepRow): GeneralResearchStep {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    runId: row.run_id,
    stepKey: row.step_key,
    phase: row.phase,
    status: row.status as GeneralResearchStepStatus,
    attempt: row.attempt,
    inputJson: row.input_json,
    outputJson: row.output_json,
    sources: mapSources(row.sources_json),
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  }
}

export const GeneralResearchRepository = {
  async findOrCreateRun(
    db: Querier,
    params: {
      workspaceId: string
      agentSessionId: string
      invocationKey: string
      toolCallId: string
      query: string
      inputHash: string
      initialPhase: string
    }
  ): Promise<GeneralResearchRun> {
    const result = await db.query<GeneralResearchRunRow>(
      sql`
        INSERT INTO general_research_runs (
          id, workspace_id, agent_session_id, invocation_key, tool_call_id,
          query, input_hash, status, current_phase
        ) VALUES (
          ${generalResearchRunId()},
          ${params.workspaceId},
          ${params.agentSessionId},
          ${params.invocationKey},
          ${params.toolCallId},
          ${params.query},
          ${params.inputHash},
          ${GeneralResearchRunStatuses.PENDING},
          ${params.initialPhase}
        )
        ON CONFLICT (agent_session_id, invocation_key) DO UPDATE
        SET tool_call_id = EXCLUDED.tool_call_id,
            updated_at = NOW()
        RETURNING ${RUN_SELECT_FIELDS}
      `
    )
    return mapRun(result.rows[0])
  },

  async findRunById(db: Querier, runId: string): Promise<GeneralResearchRun | null> {
    const result = await db.query<GeneralResearchRunRow>(
      sql`
        SELECT ${RUN_SELECT_FIELDS}
        FROM general_research_runs
        WHERE id = ${runId}
      `
    )
    return result.rows[0] ? mapRun(result.rows[0]) : null
  },

  async hasActiveRunForSession(db: Querier, agentSessionId: string): Promise<boolean> {
    const activeSessionIds = await this.listActiveRunSessionIds(db, [agentSessionId])
    return activeSessionIds.has(agentSessionId)
  },

  async listActiveRunSessionIds(db: Querier, agentSessionIds: string[]): Promise<Set<string>> {
    if (agentSessionIds.length === 0) return new Set()
    const result = await db.query<{ agent_session_id: string }>(
      sql`
        SELECT DISTINCT agent_session_id
        FROM general_research_runs
        WHERE agent_session_id = ANY(${agentSessionIds})
          AND status IN (
            ${GeneralResearchRunStatuses.PENDING},
            ${GeneralResearchRunStatuses.RUNNING}
          )
          AND (lease_expires_at IS NULL OR lease_expires_at > NOW())
      `
    )
    return new Set(result.rows.map((row) => row.agent_session_id))
  },

  async listStaleActiveRuns(db: Querier, staleBefore: Date, limit = 100): Promise<GeneralResearchRun[]> {
    const result = await db.query<GeneralResearchRunRow>(
      sql`
        SELECT ${RUN_SELECT_FIELDS}
        FROM general_research_runs
        WHERE status IN (${GeneralResearchRunStatuses.PENDING}, ${GeneralResearchRunStatuses.RUNNING})
          AND (lease_expires_at IS NULL OR lease_expires_at < ${staleBefore})
        ORDER BY updated_at ASC
        LIMIT ${limit}
      `
    )
    return result.rows.map(mapRun)
  },

  async claimRun(
    db: Querier,
    params: { runId: string; leaseOwner: string; leaseExpiresAt: Date }
  ): Promise<GeneralResearchRun | null> {
    const result = await db.query<GeneralResearchRunRow>(
      sql`
        UPDATE general_research_runs
        SET status = ${GeneralResearchRunStatuses.RUNNING},
            lease_owner = ${params.leaseOwner},
            lease_expires_at = ${params.leaseExpiresAt},
            attempt = attempt + 1,
            updated_at = NOW()
        WHERE id = ${params.runId}
          AND status IN (${GeneralResearchRunStatuses.PENDING}, ${GeneralResearchRunStatuses.RUNNING})
          AND (lease_expires_at IS NULL OR lease_expires_at < NOW() OR lease_owner = ${params.leaseOwner})
        RETURNING ${RUN_SELECT_FIELDS}
      `
    )
    return result.rows[0] ? mapRun(result.rows[0]) : null
  },

  async renewRunLease(db: Querier, params: { runId: string; leaseOwner: string; leaseExpiresAt: Date }): Promise<void> {
    await db.query(
      sql`
        UPDATE general_research_runs
        SET lease_expires_at = ${params.leaseExpiresAt},
            updated_at = NOW()
        WHERE id = ${params.runId}
          AND lease_owner = ${params.leaseOwner}
      `
    )
  },

  async releaseActiveLeasesForOwner(db: Querier, leaseOwner: string): Promise<void> {
    await db.query(
      sql`
        UPDATE general_research_runs
        SET lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
        WHERE lease_owner = ${leaseOwner}
          AND status IN (${GeneralResearchRunStatuses.PENDING}, ${GeneralResearchRunStatuses.RUNNING})
      `
    )
  },

  async updateRunPhase(db: Querier, runId: string, currentPhase: string): Promise<void> {
    await db.query(
      sql`
        UPDATE general_research_runs
        SET current_phase = ${currentPhase},
            updated_at = NOW()
        WHERE id = ${runId}
      `
    )
  },

  async completeRun(
    db: Querier,
    params: {
      runId: string
      status: GeneralResearchRunStatus
      finalAnswer?: string | null
      partialReason?: string | null
      reportStorageKey?: string | null
      outputJson?: unknown
      sources?: SourceItem[]
      leaseOwner: string
    }
  ): Promise<GeneralResearchRun | null> {
    const result = await db.query<GeneralResearchRunRow>(
      sql`
        UPDATE general_research_runs
        SET status = ${params.status},
            final_answer = ${params.finalAnswer ?? null},
            partial_reason = ${params.partialReason ?? null},
            report_storage_key = ${params.reportStorageKey ?? null},
            output_json = ${params.outputJson === undefined ? null : JSON.stringify(params.outputJson)},
            sources_json = ${JSON.stringify(params.sources ?? [])},
            lease_owner = NULL,
            lease_expires_at = NULL,
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = ${params.runId}
          AND lease_owner = ${params.leaseOwner}
          AND status IN (${GeneralResearchRunStatuses.PENDING}, ${GeneralResearchRunStatuses.RUNNING})
        RETURNING ${RUN_SELECT_FIELDS}
      `
    )
    return result.rows[0] ? mapRun(result.rows[0]) : null
  },

  async findStep(db: Querier, runId: string, stepKey: string): Promise<GeneralResearchStep | null> {
    const result = await db.query<GeneralResearchStepRow>(
      sql`
        SELECT ${STEP_SELECT_FIELDS}
        FROM general_research_steps
        WHERE run_id = ${runId}
          AND step_key = ${stepKey}
      `
    )
    return result.rows[0] ? mapStep(result.rows[0]) : null
  },

  async startStep(
    db: Querier,
    params: {
      workspaceId: string
      runId: string
      stepKey: string
      phase: string
      inputJson?: unknown
    }
  ): Promise<GeneralResearchStep> {
    const result = await db.query<GeneralResearchStepRow>(
      sql`
        INSERT INTO general_research_steps (
          id, workspace_id, run_id, step_key, phase, status, input_json
        ) VALUES (
          ${generalResearchStepId()},
          ${params.workspaceId},
          ${params.runId},
          ${params.stepKey},
          ${params.phase},
          ${GeneralResearchStepStatuses.RUNNING},
          ${params.inputJson === undefined ? null : JSON.stringify(params.inputJson)}
        )
        ON CONFLICT (run_id, step_key) DO UPDATE
        SET status = ${GeneralResearchStepStatuses.RUNNING},
            attempt = general_research_steps.attempt + 1,
            input_json = COALESCE(EXCLUDED.input_json, general_research_steps.input_json),
            error = NULL,
            updated_at = NOW()
        WHERE general_research_steps.completed_at IS NULL
        RETURNING ${STEP_SELECT_FIELDS}
      `
    )
    if (result.rows[0]) return mapStep(result.rows[0])
    const existing = await this.findStep(db, params.runId, params.stepKey)
    if (existing?.completedAt) return existing
    throw new Error(`General research step ${params.stepKey} for run ${params.runId} could not be started`)
  },

  async completeStep(
    db: Querier,
    params: { runId: string; stepKey: string; outputJson: unknown; sources?: SourceItem[] }
  ): Promise<GeneralResearchStep | null> {
    const result = await db.query<GeneralResearchStepRow>(
      sql`
        UPDATE general_research_steps
        SET status = ${GeneralResearchStepStatuses.COMPLETED},
            output_json = ${JSON.stringify(params.outputJson)},
            sources_json = ${JSON.stringify(params.sources ?? [])},
            completed_at = NOW(),
            updated_at = NOW()
        WHERE run_id = ${params.runId}
          AND step_key = ${params.stepKey}
        RETURNING ${STEP_SELECT_FIELDS}
      `
    )
    return result.rows[0] ? mapStep(result.rows[0]) : null
  },

  async failStep(db: Querier, params: { runId: string; stepKey: string; error: string }): Promise<void> {
    await db.query(
      sql`
        UPDATE general_research_steps
        SET status = ${GeneralResearchStepStatuses.FAILED},
            error = ${params.error},
            updated_at = NOW()
        WHERE run_id = ${params.runId}
          AND step_key = ${params.stepKey}
      `
    )
  },
}
