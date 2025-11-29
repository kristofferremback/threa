import { Pool, PoolClient } from "pg"
import { sql } from "../lib/db"
import { agentSessionId, sessionStepId } from "../lib/id"
import { logger } from "../lib/logger"

// Step types that map to the agent's workflow
export type SessionStepType = "gathering_context" | "reasoning" | "tool_call" | "synthesizing"

export interface SessionStep {
  id: string
  type: SessionStepType
  content: string // Human-readable description
  tool_name?: string // For tool_call type
  tool_input?: Record<string, unknown> // Tool arguments
  tool_result?: string // Truncated tool output
  started_at: string
  completed_at?: string
  status: "active" | "completed" | "failed"
}

export type SessionStatus = "active" | "summarizing" | "completed" | "failed"

export interface AgentSession {
  id: string
  workspaceId: string
  streamId: string
  triggeringEventId: string
  responseEventId: string | null
  status: SessionStatus
  steps: SessionStep[]
  summary: string | null
  errorMessage: string | null
  startedAt: string
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateSessionParams {
  workspaceId: string
  streamId: string
  triggeringEventId: string
}

export interface AddStepParams {
  sessionId: string
  type: SessionStepType
  content: string
  toolName?: string
  toolInput?: Record<string, unknown>
}

export interface CompleteStepParams {
  sessionId: string
  stepId: string
  toolResult?: string
  failed?: boolean
}

const TOOL_RESULT_MAX_LENGTH = 500

export class AgentSessionService {
  constructor(private pool: Pool) {}

  /**
   * Create a new agent session when Ariadne starts processing.
   * Returns existing session if one already exists for the triggering event (resume case).
   */
  async createSession(params: CreateSessionParams): Promise<{ session: AgentSession; isNew: boolean }> {
    // Check for existing session (resume case)
    const existing = await this.getSessionByTriggeringEvent(params.triggeringEventId)
    if (existing) {
      logger.info({ sessionId: existing.id, triggeringEventId: params.triggeringEventId }, "Resuming existing session")
      return { session: existing, isNew: false }
    }

    const id = agentSessionId()

    const result = await this.pool.query<AgentSessionRow>(
      sql`INSERT INTO agent_sessions (
        id, workspace_id, stream_id, triggering_event_id
      ) VALUES (
        ${id}, ${params.workspaceId}, ${params.streamId}, ${params.triggeringEventId}
      )
      RETURNING *`,
    )

    const session = rowToSession(result.rows[0]!)
    logger.info({ sessionId: id, streamId: params.streamId }, "Agent session created")
    return { session, isNew: true }
  }

  /**
   * Get session by ID.
   */
  async getSession(sessionId: string): Promise<AgentSession | null> {
    const result = await this.pool.query<AgentSessionRow>(
      sql`SELECT * FROM agent_sessions WHERE id = ${sessionId}`,
    )
    return result.rows[0] ? rowToSession(result.rows[0]) : null
  }

  /**
   * Get session by triggering event (for resume/deduplication).
   */
  async getSessionByTriggeringEvent(eventId: string): Promise<AgentSession | null> {
    const result = await this.pool.query<AgentSessionRow>(
      sql`SELECT * FROM agent_sessions WHERE triggering_event_id = ${eventId}`,
    )
    return result.rows[0] ? rowToSession(result.rows[0]) : null
  }

  /**
   * Get sessions for a stream (for UI display with events).
   */
  async getSessionsForStream(streamId: string): Promise<AgentSession[]> {
    const result = await this.pool.query<AgentSessionRow>(
      sql`SELECT * FROM agent_sessions
          WHERE stream_id = ${streamId}
          ORDER BY created_at ASC`,
    )
    return result.rows.map(rowToSession)
  }

  /**
   * Add a step to an active session.
   * Returns the step ID for later completion.
   */
  async addStep(params: AddStepParams): Promise<string> {
    const stepId = sessionStepId()
    const step: SessionStep = {
      id: stepId,
      type: params.type,
      content: params.content,
      tool_name: params.toolName,
      tool_input: params.toolInput,
      started_at: new Date().toISOString(),
      status: "active",
    }

    // Fetch current steps, append, and update - safer with squid's parameterization
    const session = await this.getSession(params.sessionId)
    if (!session) {
      logger.warn({ sessionId: params.sessionId }, "Session not found when adding step")
      return stepId
    }

    const updatedSteps = [...session.steps, step]

    await this.pool.query(
      sql`UPDATE agent_sessions
          SET steps = ${JSON.stringify(updatedSteps)}::jsonb,
              updated_at = NOW()
          WHERE id = ${params.sessionId}`,
    )

    logger.debug({ sessionId: params.sessionId, stepId, type: params.type }, "Session step added")
    return stepId
  }

  /**
   * Mark a step as completed (with optional tool result).
   */
  async completeStep(params: CompleteStepParams): Promise<void> {
    // Truncate tool result if too long
    const toolResult = params.toolResult
      ? params.toolResult.length > TOOL_RESULT_MAX_LENGTH
        ? params.toolResult.substring(0, TOOL_RESULT_MAX_LENGTH) + "..."
        : params.toolResult
      : null

    const completedAt = new Date().toISOString()
    const status = params.failed ? "failed" : "completed"

    // Build the update object - only include tool_result if provided
    const updateObj = toolResult
      ? { completed_at: completedAt, status, tool_result: toolResult }
      : { completed_at: completedAt, status }

    // Update the specific step in the JSONB array using a simpler approach
    // We fetch, modify in JS, and update - safer with squid's parameterization
    const session = await this.getSession(params.sessionId)
    if (!session) {
      logger.warn({ sessionId: params.sessionId, stepId: params.stepId }, "Session not found when completing step")
      return
    }

    const updatedSteps = session.steps.map((step) =>
      step.id === params.stepId ? { ...step, ...updateObj } : step,
    )

    await this.pool.query(
      sql`UPDATE agent_sessions
          SET steps = ${JSON.stringify(updatedSteps)}::jsonb,
              updated_at = NOW()
          WHERE id = ${params.sessionId}`,
    )

    logger.debug({ sessionId: params.sessionId, stepId: params.stepId, failed: params.failed }, "Session step completed")
  }

  /**
   * Update session status.
   */
  async updateStatus(sessionId: string, status: SessionStatus, errorMessage?: string): Promise<void> {
    const isFinal = status === "completed" || status === "failed"

    if (isFinal) {
      await this.pool.query(
        sql`UPDATE agent_sessions
            SET status = ${status},
                error_message = ${errorMessage ?? null},
                completed_at = ${new Date().toISOString()},
                updated_at = NOW()
            WHERE id = ${sessionId}`,
      )
    } else {
      await this.pool.query(
        sql`UPDATE agent_sessions
            SET status = ${status},
                error_message = ${errorMessage ?? null},
                updated_at = NOW()
            WHERE id = ${sessionId}`,
      )
    }

    logger.info({ sessionId, status }, "Session status updated")
  }

  /**
   * Set the summary after completion.
   */
  async setSummary(sessionId: string, summary: string): Promise<void> {
    await this.pool.query(
      sql`UPDATE agent_sessions
          SET summary = ${summary}
          WHERE id = ${sessionId}`,
    )

    logger.debug({ sessionId, summaryLength: summary.length }, "Session summary set")
  }

  /**
   * Link the response event to the session.
   */
  async linkResponseEvent(sessionId: string, responseEventId: string): Promise<void> {
    await this.pool.query(
      sql`UPDATE agent_sessions
          SET response_event_id = ${responseEventId}
          WHERE id = ${sessionId}`,
    )

    logger.debug({ sessionId, responseEventId }, "Session linked to response event")
  }

  /**
   * Move session to a different stream (e.g., when creating a thread for the response).
   */
  async moveToStream(sessionId: string, newStreamId: string): Promise<void> {
    await this.pool.query(
      sql`UPDATE agent_sessions
          SET stream_id = ${newStreamId},
              updated_at = NOW()
          WHERE id = ${sessionId}`,
    )

    logger.debug({ sessionId, newStreamId }, "Session moved to new stream")
  }

  /**
   * Get all active sessions (for resume on startup).
   */
  async getActiveSessions(): Promise<AgentSession[]> {
    const result = await this.pool.query<AgentSessionRow>(
      sql`SELECT * FROM agent_sessions WHERE status = 'active'`,
    )
    return result.rows.map(rowToSession)
  }
}

// Database row type
interface AgentSessionRow {
  id: string
  workspace_id: string
  stream_id: string
  triggering_event_id: string
  response_event_id: string | null
  status: SessionStatus
  steps: SessionStep[]
  summary: string | null
  error_message: string | null
  started_at: Date
  completed_at: Date | null
  created_at: Date
  updated_at: Date
}

function rowToSession(row: AgentSessionRow): AgentSession {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    streamId: row.stream_id,
    triggeringEventId: row.triggering_event_id,
    responseEventId: row.response_event_id,
    status: row.status,
    steps: row.steps || [],
    summary: row.summary,
    errorMessage: row.error_message,
    startedAt: row.started_at.toISOString(),
    completedAt: row.completed_at?.toISOString() || null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}
