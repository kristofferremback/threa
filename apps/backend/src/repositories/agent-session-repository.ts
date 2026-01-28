import type { AgentSessionStatus, AgentStepType, TraceSource } from "@threa/types"
import { AgentSessionStatuses, AgentStepTypes } from "@threa/types"
import type { Querier } from "../db"
import { sql } from "../db"

// Re-export for backwards compatibility
export const SessionStatuses = AgentSessionStatuses
export type SessionStatus = AgentSessionStatus
export const StepTypes = AgentStepTypes
export type StepType = AgentStepType

// Internal row types (snake_case)
interface SessionRow {
  id: string
  stream_id: string
  persona_id: string
  trigger_message_id: string
  status: string
  current_step: number
  current_step_type: string | null
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
  sources: TraceSource[] | null
  message_id: string | null
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
  currentStepType: StepType | null
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
  sources: TraceSource[] | null
  messageId: string | null
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

// Upsert params
export interface UpsertStepParams {
  id: string
  sessionId: string
  stepNumber: number
  stepType: StepType
  content?: unknown
  sources?: TraceSource[]
  messageId?: string
  tokensUsed?: number
  startedAt: Date
  completedAt?: Date
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
    currentStepType: row.current_step_type as StepType | null,
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
    sources: row.sources,
    messageId: row.message_id,
    tokensUsed: row.tokens_used,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }
}

const SESSION_SELECT_FIELDS = `
  id, stream_id, persona_id, trigger_message_id,
  status, current_step, current_step_type, server_id, heartbeat_at,
  response_message_id, error, last_seen_sequence,
  sent_message_ids, created_at, completed_at
`

const STEP_SELECT_FIELDS = `
  id, session_id, step_number, step_type,
  content, sources, message_id, tokens_used, started_at, completed_at
`

export const AgentSessionRepository = {
  // ----- Sessions -----

  async insert(db: Querier, params: InsertSessionParams): Promise<AgentSession> {
    const status = params.status ?? SessionStatuses.PENDING
    const result = await db.query<SessionRow>(
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

  /**
   * Atomically insert a RUNNING session, failing if one already exists for the stream.
   * Uses ON CONFLICT with the partial unique index to prevent race conditions.
   *
   * @returns The created session, or null if a running session already exists
   */
  async insertRunningOrSkip(
    db: Querier,
    params: Omit<InsertSessionParams, "status"> & { initialSequence: bigint }
  ): Promise<AgentSession | null> {
    const result = await db.query<SessionRow>(
      sql`
        INSERT INTO agent_sessions (
          id, stream_id, persona_id, trigger_message_id,
          status, server_id, heartbeat_at, last_seen_sequence
        ) VALUES (
          ${params.id},
          ${params.streamId},
          ${params.personaId},
          ${params.triggerMessageId},
          ${SessionStatuses.RUNNING},
          ${params.serverId ?? null},
          ${params.serverId ? new Date() : null},
          ${params.initialSequence.toString()}
        )
        ON CONFLICT (stream_id) WHERE status = 'running' DO NOTHING
        RETURNING ${sql.raw(SESSION_SELECT_FIELDS)}
      `
    )
    return result.rows[0] ? mapRowToSession(result.rows[0]) : null
  },

  async findById(db: Querier, id: string): Promise<AgentSession | null> {
    const result = await db.query<SessionRow>(
      sql`
        SELECT ${sql.raw(SESSION_SELECT_FIELDS)}
        FROM agent_sessions
        WHERE id = ${id}
      `
    )
    return result.rows[0] ? mapRowToSession(result.rows[0]) : null
  },

  async findByTriggerMessage(db: Querier, triggerMessageId: string): Promise<AgentSession | null> {
    const result = await db.query<SessionRow>(
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
    db: Querier,
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

    const result = await db.query<SessionRow>(
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

  async updateHeartbeat(db: Querier, id: string): Promise<void> {
    await db.query(
      sql`
        UPDATE agent_sessions
        SET heartbeat_at = NOW()
        WHERE id = ${id}
      `
    )
  },

  async updateCurrentStep(db: Querier, id: string, stepNumber: number): Promise<void> {
    await db.query(
      sql`
        UPDATE agent_sessions
        SET current_step = ${stepNumber}, heartbeat_at = NOW()
        WHERE id = ${id}
      `
    )
  },

  /**
   * Update the current step type for a session.
   * Used for cross-stream activity display ("Ariadne is thinking...").
   */
  async updateCurrentStepType(db: Querier, id: string, stepType: StepType | null): Promise<void> {
    await db.query(
      sql`
        UPDATE agent_sessions
        SET current_step_type = ${stepType}, heartbeat_at = NOW()
        WHERE id = ${id}
      `
    )
  },

  /**
   * Find sessions that are running but have stale heartbeats.
   * These are candidates for recovery/retry.
   */
  async findOrphaned(db: Querier, staleThresholdSeconds: number = 60): Promise<AgentSession[]> {
    const result = await db.query<SessionRow>(
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
   * Find a running session for a stream.
   *
   * NOTE: This is a utility method for inspection/debugging. The main session
   * creation flow uses `insertRunningOrSkip()` which atomically prevents duplicates
   * via the partial unique index on (stream_id) WHERE status='running'.
   *
   * Uses FOR UPDATE SKIP LOCKED to avoid blocking concurrent transactions.
   */
  async findRunningByStream(db: Querier, streamId: string): Promise<AgentSession | null> {
    const result = await db.query<SessionRow>(
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
  async findLatestByStream(db: Querier, streamId: string): Promise<AgentSession | null> {
    const result = await db.query<SessionRow>(
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
  async updateLastSeenSequence(db: Querier, id: string, sequence: bigint): Promise<void> {
    await db.query(
      sql`
        UPDATE agent_sessions
        SET last_seen_sequence = ${sequence.toString()}, heartbeat_at = NOW()
        WHERE id = ${id}
      `
    )
  },

  /**
   * Complete a session atomically - updates last seen sequence and status in one query.
   * This prevents partial updates if the process crashes between separate calls.
   */
  async completeSession(
    db: Querier,
    id: string,
    params: {
      lastSeenSequence: bigint
      responseMessageId?: string | null
      sentMessageIds?: string[]
    }
  ): Promise<AgentSession | null> {
    const result = await db.query<SessionRow>(
      sql`
        UPDATE agent_sessions
        SET
          status = ${SessionStatuses.COMPLETED},
          last_seen_sequence = ${params.lastSeenSequence.toString()},
          response_message_id = ${params.responseMessageId ?? null},
          sent_message_ids = ${params.sentMessageIds ?? null},
          current_step_type = NULL,
          completed_at = NOW()
        WHERE id = ${id}
        RETURNING ${sql.raw(SESSION_SELECT_FIELDS)}
      `
    )
    return result.rows[0] ? mapRowToSession(result.rows[0]) : null
  },

  // ----- Steps -----

  async upsertStep(db: Querier, params: UpsertStepParams): Promise<AgentSessionStep> {
    const result = await db.query<StepRow>(
      sql`
        INSERT INTO agent_session_steps (
          id, session_id, step_number, step_type, content, sources,
          message_id, tokens_used, started_at, completed_at
        ) VALUES (
          ${params.id},
          ${params.sessionId},
          ${params.stepNumber},
          ${params.stepType},
          ${params.content ? JSON.stringify(params.content) : null},
          ${params.sources ? JSON.stringify(params.sources) : null},
          ${params.messageId ?? null},
          ${params.tokensUsed ?? null},
          ${params.startedAt},
          ${params.completedAt ?? null}
        )
        ON CONFLICT (session_id, step_number) DO UPDATE
        SET
          step_type = EXCLUDED.step_type,
          content = COALESCE(EXCLUDED.content, agent_session_steps.content),
          sources = COALESCE(EXCLUDED.sources, agent_session_steps.sources),
          message_id = COALESCE(EXCLUDED.message_id, agent_session_steps.message_id),
          tokens_used = COALESCE(EXCLUDED.tokens_used, agent_session_steps.tokens_used),
          started_at = EXCLUDED.started_at,
          completed_at = COALESCE(EXCLUDED.completed_at, agent_session_steps.completed_at)
        RETURNING ${sql.raw(STEP_SELECT_FIELDS)}
      `
    )
    return mapRowToStep(result.rows[0])
  },

  async completeStep(db: Querier, stepId: string, tokensUsed?: number): Promise<AgentSessionStep | null> {
    const result = await db.query<StepRow>(
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

  async updateStep(
    db: Querier,
    stepId: string,
    params: {
      content?: unknown
      sources?: TraceSource[]
      messageId?: string
      completedAt?: Date
    }
  ): Promise<AgentSessionStep | null> {
    const result = await db.query<StepRow>(
      sql`
        UPDATE agent_session_steps
        SET
          content = COALESCE(${params.content != null ? JSON.stringify(params.content) : null}, content),
          sources = COALESCE(${params.sources ? JSON.stringify(params.sources) : null}, sources),
          message_id = COALESCE(${params.messageId ?? null}, message_id),
          completed_at = COALESCE(${params.completedAt ?? null}, completed_at)
        WHERE id = ${stepId}
        RETURNING ${sql.raw(STEP_SELECT_FIELDS)}
      `
    )
    return result.rows[0] ? mapRowToStep(result.rows[0]) : null
  },

  async findStepsBySession(db: Querier, sessionId: string, limit: number = 500): Promise<AgentSessionStep[]> {
    const result = await db.query<StepRow>(
      sql`
        SELECT ${sql.raw(STEP_SELECT_FIELDS)}
        FROM agent_session_steps
        WHERE session_id = ${sessionId}
        ORDER BY step_number ASC
        LIMIT ${limit}
      `
    )
    return result.rows.map(mapRowToStep)
  },

  async findLatestStep(db: Querier, sessionId: string): Promise<AgentSessionStep | null> {
    const result = await db.query<StepRow>(
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
