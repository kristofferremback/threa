import type { PoolClient } from "pg"
import { sql } from "../db"

// Session status values
export const SessionStatuses = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
} as const

export type SessionStatus = (typeof SessionStatuses)[keyof typeof SessionStatuses]

// Step type values
export const StepTypes = {
  THINKING: "thinking",
  TOOL_CALL: "tool_call",
  TOOL_RESULT: "tool_result",
  RESPONSE: "response",
} as const

export type StepType = (typeof StepTypes)[keyof typeof StepTypes]

// Internal row types (snake_case)
interface SessionRow {
  id: string
  stream_id: string
  persona_id: string
  trigger_message_id: string
  status: string
  current_step: number
  server_id: string | null
  heartbeat_at: Date | null
  response_message_id: string | null
  error: string | null
  last_seen_sequence: string | null
  sent_message_ids: string[] | null
  created_at: Date
  completed_at: Date | null
}

interface StepRow {
  id: string
  session_id: string
  step_number: number
  step_type: string
  content: unknown
  tokens_used: number | null
  started_at: Date
  completed_at: Date | null
}

// Domain types (camelCase)
export interface AgentSession {
  id: string
  streamId: string
  personaId: string
  triggerMessageId: string
  status: SessionStatus
  currentStep: number
  serverId: string | null
  heartbeatAt: Date | null
  responseMessageId: string | null
  error: string | null
  lastSeenSequence: bigint | null
  sentMessageIds: string[]
  createdAt: Date
  completedAt: Date | null
}

export interface AgentSessionStep {
  id: string
  sessionId: string
  stepNumber: number
  stepType: StepType
  content: unknown
  tokensUsed: number | null
  startedAt: Date
  completedAt: Date | null
}

// Insert params
export interface InsertSessionParams {
  id: string
  streamId: string
  personaId: string
  triggerMessageId: string
  status?: SessionStatus
  serverId?: string
}

export interface InsertStepParams {
  id: string
  sessionId: string
  stepNumber: number
  stepType: StepType
  content?: unknown
  tokensUsed?: number
}

// Mappers
function mapRowToSession(row: SessionRow): AgentSession {
  return {
    id: row.id,
    streamId: row.stream_id,
    personaId: row.persona_id,
    triggerMessageId: row.trigger_message_id,
    status: row.status as SessionStatus,
    currentStep: row.current_step,
    serverId: row.server_id,
    heartbeatAt: row.heartbeat_at,
    responseMessageId: row.response_message_id,
    error: row.error,
    lastSeenSequence: row.last_seen_sequence ? BigInt(row.last_seen_sequence) : null,
    sentMessageIds: row.sent_message_ids ?? [],
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

function mapRowToStep(row: StepRow): AgentSessionStep {
  return {
    id: row.id,
    sessionId: row.session_id,
    stepNumber: row.step_number,
    stepType: row.step_type as StepType,
    content: row.content,
    tokensUsed: row.tokens_used,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }
}

const SESSION_SELECT_FIELDS = `
  id, stream_id, persona_id, trigger_message_id,
  status, current_step, server_id, heartbeat_at,
  response_message_id, error, last_seen_sequence,
  sent_message_ids, created_at, completed_at
`

const STEP_SELECT_FIELDS = `
  id, session_id, step_number, step_type,
  content, tokens_used, started_at, completed_at
`

export const AgentSessionRepository = {
  // ----- Sessions -----

  async insert(client: PoolClient, params: InsertSessionParams): Promise<AgentSession> {
    const status = params.status ?? SessionStatuses.PENDING
    const result = await client.query<SessionRow>(
      sql`
        INSERT INTO agent_sessions (
          id, stream_id, persona_id, trigger_message_id,
          status, server_id, heartbeat_at
        ) VALUES (
          ${params.id},
          ${params.streamId},
          ${params.personaId},
          ${params.triggerMessageId},
          ${status},
          ${params.serverId ?? null},
          ${params.serverId ? new Date() : null}
        )
        RETURNING ${sql.raw(SESSION_SELECT_FIELDS)}
      `
    )
    return mapRowToSession(result.rows[0])
  },

  async findById(client: PoolClient, id: string): Promise<AgentSession | null> {
    const result = await client.query<SessionRow>(
      sql`
        SELECT ${sql.raw(SESSION_SELECT_FIELDS)}
        FROM agent_sessions
        WHERE id = ${id}
      `
    )
    return result.rows[0] ? mapRowToSession(result.rows[0]) : null
  },

  async findByTriggerMessage(client: PoolClient, triggerMessageId: string): Promise<AgentSession | null> {
    const result = await client.query<SessionRow>(
      sql`
        SELECT ${sql.raw(SESSION_SELECT_FIELDS)}
        FROM agent_sessions
        WHERE trigger_message_id = ${triggerMessageId}
        ORDER BY created_at DESC
        LIMIT 1
      `
    )
    return result.rows[0] ? mapRowToSession(result.rows[0]) : null
  },

  async updateStatus(
    client: PoolClient,
    id: string,
    status: SessionStatus,
    extras?: {
      serverId?: string
      responseMessageId?: string
      sentMessageIds?: string[]
      error?: string
    }
  ): Promise<AgentSession | null> {
    const now = new Date()
    const completedAt = status === SessionStatuses.COMPLETED || status === SessionStatuses.FAILED ? now : null

    const result = await client.query<SessionRow>(
      sql`
        UPDATE agent_sessions
        SET
          status = ${status},
          server_id = COALESCE(${extras?.serverId ?? null}, server_id),
          heartbeat_at = ${status === SessionStatuses.RUNNING ? now : sql.raw("heartbeat_at")},
          response_message_id = COALESCE(${extras?.responseMessageId ?? null}, response_message_id),
          sent_message_ids = COALESCE(${extras?.sentMessageIds ?? null}, sent_message_ids),
          error = COALESCE(${extras?.error ?? null}, error),
          completed_at = ${completedAt}
        WHERE id = ${id}
        RETURNING ${sql.raw(SESSION_SELECT_FIELDS)}
      `
    )
    return result.rows[0] ? mapRowToSession(result.rows[0]) : null
  },

  async updateHeartbeat(client: PoolClient, id: string): Promise<void> {
    await client.query(
      sql`
        UPDATE agent_sessions
        SET heartbeat_at = NOW()
        WHERE id = ${id}
      `
    )
  },

  async updateCurrentStep(client: PoolClient, id: string, stepNumber: number): Promise<void> {
    await client.query(
      sql`
        UPDATE agent_sessions
        SET current_step = ${stepNumber}, heartbeat_at = NOW()
        WHERE id = ${id}
      `
    )
  },

  /**
   * Find sessions that are running but have stale heartbeats.
   * These are candidates for recovery/retry.
   */
  async findOrphaned(client: PoolClient, staleThresholdSeconds: number = 60): Promise<AgentSession[]> {
    const result = await client.query<SessionRow>(
      sql`
        SELECT ${sql.raw(SESSION_SELECT_FIELDS)}
        FROM agent_sessions
        WHERE status = ${SessionStatuses.RUNNING}
          AND heartbeat_at < NOW() - INTERVAL '1 second' * ${staleThresholdSeconds}
      `
    )
    return result.rows.map(mapRowToSession)
  },

  /**
   * Find a running session for a stream, locking it to prevent race conditions.
   * Uses FOR UPDATE SKIP LOCKED so concurrent calls don't block.
   * Returns null if no running session exists (or all are locked by other transactions).
   */
  async findRunningByStream(client: PoolClient, streamId: string): Promise<AgentSession | null> {
    const result = await client.query<SessionRow>(
      sql`
        SELECT ${sql.raw(SESSION_SELECT_FIELDS)}
        FROM agent_sessions
        WHERE stream_id = ${streamId}
          AND status = ${SessionStatuses.RUNNING}
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `
    )
    return result.rows[0] ? mapRowToSession(result.rows[0]) : null
  },

  /**
   * Find the most recent session for a stream (regardless of status).
   * Used to check lastSeenSequence when deciding whether to dispatch a new job.
   */
  async findLatestByStream(client: PoolClient, streamId: string): Promise<AgentSession | null> {
    const result = await client.query<SessionRow>(
      sql`
        SELECT ${sql.raw(SESSION_SELECT_FIELDS)}
        FROM agent_sessions
        WHERE stream_id = ${streamId}
        ORDER BY created_at DESC
        LIMIT 1
      `
    )
    return result.rows[0] ? mapRowToSession(result.rows[0]) : null
  },

  /**
   * Update the last seen sequence for a session.
   * Called during agent loop when new messages are processed.
   */
  async updateLastSeenSequence(client: PoolClient, id: string, sequence: bigint): Promise<void> {
    await client.query(
      sql`
        UPDATE agent_sessions
        SET last_seen_sequence = ${sequence.toString()}, heartbeat_at = NOW()
        WHERE id = ${id}
      `
    )
  },

  // ----- Steps -----

  async insertStep(client: PoolClient, params: InsertStepParams): Promise<AgentSessionStep> {
    const result = await client.query<StepRow>(
      sql`
        INSERT INTO agent_session_steps (
          id, session_id, step_number, step_type, content, tokens_used
        ) VALUES (
          ${params.id},
          ${params.sessionId},
          ${params.stepNumber},
          ${params.stepType},
          ${params.content ? JSON.stringify(params.content) : null},
          ${params.tokensUsed ?? null}
        )
        RETURNING ${sql.raw(STEP_SELECT_FIELDS)}
      `
    )
    return mapRowToStep(result.rows[0])
  },

  async completeStep(client: PoolClient, stepId: string, tokensUsed?: number): Promise<AgentSessionStep | null> {
    const result = await client.query<StepRow>(
      sql`
        UPDATE agent_session_steps
        SET
          completed_at = NOW(),
          tokens_used = COALESCE(${tokensUsed ?? null}, tokens_used)
        WHERE id = ${stepId}
        RETURNING ${sql.raw(STEP_SELECT_FIELDS)}
      `
    )
    return result.rows[0] ? mapRowToStep(result.rows[0]) : null
  },

  async findStepsBySession(client: PoolClient, sessionId: string): Promise<AgentSessionStep[]> {
    const result = await client.query<StepRow>(
      sql`
        SELECT ${sql.raw(STEP_SELECT_FIELDS)}
        FROM agent_session_steps
        WHERE session_id = ${sessionId}
        ORDER BY step_number ASC
      `
    )
    return result.rows.map(mapRowToStep)
  },

  async findLatestStep(client: PoolClient, sessionId: string): Promise<AgentSessionStep | null> {
    const result = await client.query<StepRow>(
      sql`
        SELECT ${sql.raw(STEP_SELECT_FIELDS)}
        FROM agent_session_steps
        WHERE session_id = ${sessionId}
        ORDER BY step_number DESC
        LIMIT 1
      `
    )
    return result.rows[0] ? mapRowToStep(result.rows[0]) : null
  },
}
