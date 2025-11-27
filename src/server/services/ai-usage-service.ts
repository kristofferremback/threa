import { Pool } from "pg"
import { sql } from "../lib/db"
import { aiUsageId } from "../lib/id"
import { logger } from "../lib/logger"

export interface TrackUsageParams {
  workspaceId: string
  userId?: string
  jobType: "embed" | "classify" | "respond" | "extract"
  model: string
  inputTokens: number
  outputTokens?: number
  costCents?: number
  streamId?: string
  eventId?: string
  jobId?: string
  metadata?: Record<string, unknown>
}

export interface UsageSummary {
  jobType: string
  model: string
  totalInputTokens: number
  totalOutputTokens: number
  totalCostCents: number
  count: number
}

export interface MonthlyUsage {
  month: string
  totalCostCents: number
  breakdown: UsageSummary[]
}

export class AIUsageService {
  constructor(private pool: Pool) {}

  /**
   * Track an AI operation for billing and analytics.
   */
  async trackUsage(params: TrackUsageParams): Promise<void> {
    const id = aiUsageId()
    const costCents = params.costCents ?? 0

    try {
      await this.pool.query(
        sql`INSERT INTO ai_usage (
          id, workspace_id, user_id, job_type, model,
          input_tokens, output_tokens, cost_cents,
          stream_id, event_id, job_id, metadata
        ) VALUES (
          ${id}, ${params.workspaceId}, ${params.userId || null}, ${params.jobType}, ${params.model},
          ${params.inputTokens}, ${params.outputTokens || null}, ${costCents},
          ${params.streamId || null}, ${params.eventId || null}, ${params.jobId || null},
          ${JSON.stringify(params.metadata || {})}
        )`,
      )

      logger.debug(
        {
          workspaceId: params.workspaceId,
          jobType: params.jobType,
          model: params.model,
          inputTokens: params.inputTokens,
          costCents,
        },
        "AI usage tracked",
      )
    } catch (err) {
      logger.error({ err, params }, "Failed to track AI usage")
      // Don't throw - usage tracking shouldn't break the main operation
    }
  }

  /**
   * Get current month's usage for a workspace.
   */
  async getMonthlyUsage(workspaceId: string): Promise<MonthlyUsage> {
    const result = await this.pool.query<{
      job_type: string
      model: string
      total_input_tokens: string
      total_output_tokens: string
      total_cost_cents: string
      count: string
    }>(
      sql`SELECT
        job_type,
        model,
        SUM(input_tokens)::text as total_input_tokens,
        SUM(COALESCE(output_tokens, 0))::text as total_output_tokens,
        SUM(cost_cents)::text as total_cost_cents,
        COUNT(*)::text as count
      FROM ai_usage
      WHERE workspace_id = ${workspaceId}
        AND created_at >= DATE_TRUNC('month', NOW())
      GROUP BY job_type, model
      ORDER BY job_type, model`,
    )

    const breakdown: UsageSummary[] = result.rows.map((row) => ({
      jobType: row.job_type,
      model: row.model,
      totalInputTokens: parseInt(row.total_input_tokens, 10),
      totalOutputTokens: parseInt(row.total_output_tokens, 10),
      totalCostCents: parseFloat(row.total_cost_cents),
      count: parseInt(row.count, 10),
    }))

    const totalCostCents = breakdown.reduce((sum, b) => sum + b.totalCostCents, 0)

    return {
      month: new Date().toISOString().slice(0, 7), // YYYY-MM
      totalCostCents,
      breakdown,
    }
  }

  /**
   * Check if workspace is within AI budget.
   */
  async checkBudget(workspaceId: string): Promise<{
    withinBudget: boolean
    usedCents: number
    budgetCents: number
    usagePercent: number
  }> {
    const [usageResult, workspaceResult] = await Promise.all([
      this.pool.query<{ total: string }>(
        sql`SELECT COALESCE(SUM(cost_cents), 0)::text as total
          FROM ai_usage
          WHERE workspace_id = ${workspaceId}
            AND created_at >= DATE_TRUNC('month', NOW())`,
      ),
      this.pool.query<{ ai_budget_cents_monthly: number }>(
        sql`SELECT ai_budget_cents_monthly FROM workspaces WHERE id = ${workspaceId}`,
      ),
    ])

    const usedCents = parseFloat(usageResult.rows[0]?.total || "0")
    const budgetCents = workspaceResult.rows[0]?.ai_budget_cents_monthly ?? 10000
    const usagePercent = budgetCents > 0 ? (usedCents / budgetCents) * 100 : 0

    return {
      withinBudget: usedCents < budgetCents,
      usedCents,
      budgetCents,
      usagePercent,
    }
  }

  /**
   * Check if AI features are enabled for a workspace.
   */
  async isAIEnabled(workspaceId: string): Promise<boolean> {
    const result = await this.pool.query<{ ai_enabled: boolean }>(
      sql`SELECT ai_enabled FROM workspaces WHERE id = ${workspaceId}`,
    )
    return result.rows[0]?.ai_enabled ?? false
  }

  /**
   * Get usage statistics for the AI admin dashboard.
   */
  async getUsageStats(
    workspaceId: string,
    options: { days?: number } = {},
  ): Promise<{
    dailyUsage: Array<{ date: string; costCents: number; jobs: number }>
    topUsers: Array<{ userId: string; costCents: number; jobs: number }>
    jobTypeBreakdown: UsageSummary[]
  }> {
    const days = options.days ?? 30

    const [dailyResult, userResult, jobTypeResult] = await Promise.all([
      // Daily usage
      this.pool.query<{ date: string; cost_cents: string; jobs: string }>(
        sql`SELECT
          DATE(created_at)::text as date,
          SUM(cost_cents)::text as cost_cents,
          COUNT(*)::text as jobs
        FROM ai_usage
        WHERE workspace_id = ${workspaceId}
          AND created_at >= NOW() - INTERVAL '1 day' * ${days}
        GROUP BY DATE(created_at)
        ORDER BY date DESC`,
      ),
      // Top users
      this.pool.query<{ user_id: string; cost_cents: string; jobs: string }>(
        sql`SELECT
          user_id,
          SUM(cost_cents)::text as cost_cents,
          COUNT(*)::text as jobs
        FROM ai_usage
        WHERE workspace_id = ${workspaceId}
          AND user_id IS NOT NULL
          AND created_at >= NOW() - INTERVAL '1 day' * ${days}
        GROUP BY user_id
        ORDER BY SUM(cost_cents) DESC
        LIMIT 10`,
      ),
      // Job type breakdown
      this.pool.query<{
        job_type: string
        model: string
        total_input_tokens: string
        total_output_tokens: string
        total_cost_cents: string
        count: string
      }>(
        sql`SELECT
          job_type,
          model,
          SUM(input_tokens)::text as total_input_tokens,
          SUM(COALESCE(output_tokens, 0))::text as total_output_tokens,
          SUM(cost_cents)::text as total_cost_cents,
          COUNT(*)::text as count
        FROM ai_usage
        WHERE workspace_id = ${workspaceId}
          AND created_at >= NOW() - INTERVAL '1 day' * ${days}
        GROUP BY job_type, model
        ORDER BY SUM(cost_cents) DESC`,
      ),
    ])

    return {
      dailyUsage: dailyResult.rows.map((row) => ({
        date: row.date,
        costCents: parseFloat(row.cost_cents),
        jobs: parseInt(row.jobs, 10),
      })),
      topUsers: userResult.rows.map((row) => ({
        userId: row.user_id,
        costCents: parseFloat(row.cost_cents),
        jobs: parseInt(row.jobs, 10),
      })),
      jobTypeBreakdown: jobTypeResult.rows.map((row) => ({
        jobType: row.job_type,
        model: row.model,
        totalInputTokens: parseInt(row.total_input_tokens, 10),
        totalOutputTokens: parseInt(row.total_output_tokens, 10),
        totalCostCents: parseFloat(row.total_cost_cents),
        count: parseInt(row.count, 10),
      })),
    }
  }
}

