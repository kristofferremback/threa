import { Pool } from "pg"
import { sql } from "../lib/db"
import { logger } from "../lib/logger"
import { randomUUID } from "crypto"

const PREVIEW_LENGTH = 500

type TraceStatus = "running" | "success" | "error"
type TraceProvider = "ollama" | "anthropic" | "openai" | "langchain"

export interface TraceContext {
  traceId: string
  parentSpanId?: string
  workspaceId?: string
  userId?: string
  streamId?: string
  eventId?: string
  jobId?: string
}

export interface SpanOptions {
  operation: string
  provider: TraceProvider
  model?: string
  input?: string
  metadata?: Record<string, unknown>
}

export interface Span {
  id: string
  traceId: string
  parentSpanId?: string
  operation: string
  provider: TraceProvider
  model?: string
  startedAt: Date
  end: (result: SpanResult) => Promise<void>
  child: (options: SpanOptions) => Promise<Span>
}

export interface SpanResult {
  status: TraceStatus
  output?: string
  inputTokens?: number
  outputTokens?: number
  errorMessage?: string
  errorCode?: string
  metadata?: Record<string, unknown>
}

/**
 * AI Trace Service - Collects traces from AI operations.
 *
 * Provides observability into Ollama, Anthropic, OpenAI, and LangChain calls
 * with timing, token usage, and error tracking.
 */
export class AITraceService {
  constructor(private pool: Pool) {}

  /**
   * Create a new trace context for a user request or background job.
   */
  createContext(options: Partial<TraceContext> = {}): TraceContext {
    return {
      traceId: options.traceId || `trace_${randomUUID()}`,
      parentSpanId: options.parentSpanId,
      workspaceId: options.workspaceId,
      userId: options.userId,
      streamId: options.streamId,
      eventId: options.eventId,
      jobId: options.jobId,
    }
  }

  /**
   * Start a new span for an AI operation.
   */
  async startSpan(context: TraceContext, options: SpanOptions): Promise<Span> {
    const spanId = `span_${randomUUID()}`
    const startedAt = new Date()

    const inputPreview = options.input ? truncate(options.input, PREVIEW_LENGTH) : undefined

    try {
      await this.pool.query(
        sql`INSERT INTO ai_traces (
          id, trace_id, parent_span_id, workspace_id, user_id,
          operation, model, provider, started_at, status,
          input_preview, stream_id, event_id, job_id, metadata
        ) VALUES (
          ${spanId}, ${context.traceId}, ${context.parentSpanId || null},
          ${context.workspaceId || null}, ${context.userId || null},
          ${options.operation}, ${options.model || null}, ${options.provider},
          ${startedAt.toISOString()}, 'running',
          ${inputPreview || null}, ${context.streamId || null},
          ${context.eventId || null}, ${context.jobId || null},
          ${JSON.stringify(options.metadata || {})}
        )`,
      )
    } catch (err) {
      logger.error({ err, spanId, operation: options.operation }, "Failed to create trace span")
    }

    const span: Span = {
      id: spanId,
      traceId: context.traceId,
      parentSpanId: context.parentSpanId,
      operation: options.operation,
      provider: options.provider,
      model: options.model,
      startedAt,
      end: async (result: SpanResult) => {
        await this.endSpan(spanId, startedAt, result)
      },
      child: async (childOptions: SpanOptions) => {
        const childContext: TraceContext = {
          ...context,
          parentSpanId: spanId,
        }
        return this.startSpan(childContext, childOptions)
      },
    }

    return span
  }

  /**
   * End a span with results.
   */
  private async endSpan(spanId: string, startedAt: Date, result: SpanResult): Promise<void> {
    const endedAt = new Date()
    const durationMs = endedAt.getTime() - startedAt.getTime()
    const outputPreview = result.output ? truncate(result.output, PREVIEW_LENGTH) : undefined

    try {
      await this.pool.query(
        sql`UPDATE ai_traces SET
          ended_at = ${endedAt.toISOString()},
          duration_ms = ${durationMs},
          status = ${result.status},
          output_preview = ${outputPreview || null},
          input_tokens = ${result.inputTokens || null},
          output_tokens = ${result.outputTokens || null},
          error_message = ${result.errorMessage || null},
          error_code = ${result.errorCode || null},
          metadata = metadata || ${JSON.stringify(result.metadata || {})}::jsonb
        WHERE id = ${spanId}`,
      )
    } catch (err) {
      logger.error({ err, spanId }, "Failed to end trace span")
    }
  }

  /**
   * Get traces for a specific trace ID.
   */
  async getTrace(traceId: string): Promise<TraceRow[]> {
    const result = await this.pool.query<TraceRow>(
      sql`SELECT * FROM ai_traces WHERE trace_id = ${traceId} ORDER BY started_at`,
    )
    return result.rows
  }

  /**
   * Get recent traces for a workspace.
   */
  async getRecentTraces(
    workspaceId: string,
    options: { limit?: number; operation?: string; status?: TraceStatus } = {},
  ): Promise<TraceRow[]> {
    const limit = options.limit || 100

    let query = sql`SELECT * FROM ai_traces WHERE workspace_id = ${workspaceId}`

    if (options.operation) {
      query = sql`${query} AND operation = ${options.operation}`
    }
    if (options.status) {
      query = sql`${query} AND status = ${options.status}`
    }

    query = sql`${query} ORDER BY started_at DESC LIMIT ${limit}`

    const result = await this.pool.query<TraceRow>(query)
    return result.rows
  }

  /**
   * Get trace statistics for a workspace.
   */
  async getTraceStats(
    workspaceId: string,
    options: { since?: Date } = {},
  ): Promise<TraceStats> {
    const since = options.since || new Date(Date.now() - 24 * 60 * 60 * 1000)

    const result = await this.pool.query<{
      operation: string
      total_count: string
      success_count: string
      error_count: string
      avg_duration_ms: string
      p95_duration_ms: string
      total_input_tokens: string
      total_output_tokens: string
    }>(
      sql`SELECT
        operation,
        COUNT(*) as total_count,
        COUNT(*) FILTER (WHERE status = 'success') as success_count,
        COUNT(*) FILTER (WHERE status = 'error') as error_count,
        AVG(duration_ms)::int as avg_duration_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::int as p95_duration_ms,
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens
      FROM ai_traces
      WHERE workspace_id = ${workspaceId}
        AND started_at >= ${since.toISOString()}
        AND status != 'running'
      GROUP BY operation
      ORDER BY total_count DESC`,
    )

    return {
      since,
      operations: result.rows.map((row) => ({
        operation: row.operation,
        totalCount: parseInt(row.total_count, 10),
        successCount: parseInt(row.success_count, 10),
        errorCount: parseInt(row.error_count, 10),
        avgDurationMs: parseInt(row.avg_duration_ms || "0", 10),
        p95DurationMs: parseInt(row.p95_duration_ms || "0", 10),
        totalInputTokens: parseInt(row.total_input_tokens, 10),
        totalOutputTokens: parseInt(row.total_output_tokens, 10),
      })),
    }
  }

  /**
   * Get slow traces for analysis.
   */
  async getSlowTraces(
    options: { workspaceId?: string; minDurationMs?: number; limit?: number } = {},
  ): Promise<TraceRow[]> {
    const minDurationMs = options.minDurationMs || 5000
    const limit = options.limit || 50

    let query = sql`SELECT * FROM ai_traces
      WHERE duration_ms >= ${minDurationMs}
        AND status != 'running'`

    if (options.workspaceId) {
      query = sql`${query} AND workspace_id = ${options.workspaceId}`
    }

    query = sql`${query} ORDER BY duration_ms DESC LIMIT ${limit}`

    const result = await this.pool.query<TraceRow>(query)
    return result.rows
  }

  /**
   * Get error traces for debugging.
   */
  async getErrorTraces(
    options: { workspaceId?: string; since?: Date; limit?: number } = {},
  ): Promise<TraceRow[]> {
    const since = options.since || new Date(Date.now() - 24 * 60 * 60 * 1000)
    const limit = options.limit || 100

    let query = sql`SELECT * FROM ai_traces
      WHERE status = 'error'
        AND started_at >= ${since.toISOString()}`

    if (options.workspaceId) {
      query = sql`${query} AND workspace_id = ${options.workspaceId}`
    }

    query = sql`${query} ORDER BY started_at DESC LIMIT ${limit}`

    const result = await this.pool.query<TraceRow>(query)
    return result.rows
  }

  /**
   * Clean up old traces (retention policy).
   */
  async cleanupOldTraces(retentionDays: number = 30): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)

    const result = await this.pool.query(
      sql`DELETE FROM ai_traces WHERE started_at < ${cutoff.toISOString()}`,
    )

    const deleted = result.rowCount || 0
    if (deleted > 0) {
      logger.info({ deleted, retentionDays }, "Cleaned up old AI traces")
    }

    return deleted
  }
}

export interface TraceRow {
  id: string
  trace_id: string
  parent_span_id: string | null
  workspace_id: string | null
  user_id: string | null
  operation: string
  model: string | null
  provider: string
  started_at: Date
  ended_at: Date | null
  duration_ms: number | null
  status: TraceStatus
  error_message: string | null
  error_code: string | null
  input_tokens: number | null
  output_tokens: number | null
  input_preview: string | null
  output_preview: string | null
  stream_id: string | null
  event_id: string | null
  job_id: string | null
  metadata: Record<string, unknown>
  created_at: Date
}

export interface TraceStats {
  since: Date
  operations: Array<{
    operation: string
    totalCount: number
    successCount: number
    errorCount: number
    avgDurationMs: number
    p95DurationMs: number
    totalInputTokens: number
    totalOutputTokens: number
  }>
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + "..."
}

/**
 * Convenience wrapper to trace an async operation.
 */
export async function traced<T>(
  traceService: AITraceService,
  context: TraceContext,
  options: SpanOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const span = await traceService.startSpan(context, options)

  try {
    const result = await fn(span)
    await span.end({ status: "success" })
    return result
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    await span.end({
      status: "error",
      errorMessage,
      errorCode: err instanceof Error ? err.name : undefined,
    })
    throw err
  }
}
