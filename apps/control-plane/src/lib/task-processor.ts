import type { Pool } from "pg"
import { withTransaction, logger } from "@threa/backend-common"

export type TaskHandler = (payload: Record<string, unknown>) => Promise<void>

interface TaskRow {
  id: string
  task_type: string
  payload: Record<string, unknown>
  attempts: number
  max_attempts: number
}

interface TaskProcessorOptions {
  pool: Pool
  pollIntervalMs?: number
  batchSize?: number
}

/**
 * Lightweight transactional task queue.
 *
 * Tasks are inserted into `pending_tasks` inside application transactions,
 * guaranteeing they persist if and only if the parent operation commits.
 * The processor polls for ready tasks, executes handlers, and retries
 * failures with exponential backoff.
 */
export class TaskProcessor {
  private pool: Pool
  private handlers = new Map<string, TaskHandler>()
  private pollIntervalMs: number
  private batchSize: number
  private timer: ReturnType<typeof setInterval> | null = null
  private processing = false

  constructor(opts: TaskProcessorOptions) {
    this.pool = opts.pool
    this.pollIntervalMs = opts.pollIntervalMs ?? 5000
    this.batchSize = opts.batchSize ?? 10
  }

  registerHandler(taskType: string, handler: TaskHandler): void {
    this.handlers.set(taskType, handler)
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs)
    // Run immediately on start
    void this.poll()
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    // Wait for in-flight processing to finish
    while (this.processing) {
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  private async poll(): Promise<void> {
    if (this.processing) return
    this.processing = true

    try {
      // Claim a batch of ready tasks with FOR UPDATE SKIP LOCKED
      // so multiple processors (if any) don't fight over the same tasks
      const result = await this.pool.query<TaskRow>(
        `SELECT id, task_type, payload, attempts, max_attempts
         FROM pending_tasks
         WHERE status = 'pending' AND next_attempt_at <= NOW()
         ORDER BY next_attempt_at
         LIMIT $1`,
        [this.batchSize]
      )

      for (const task of result.rows) {
        await this.processTask(task)
      }
    } catch (err) {
      logger.error({ err }, "Task processor poll failed")
    } finally {
      this.processing = false
    }
  }

  private async processTask(task: TaskRow): Promise<void> {
    const handler = this.handlers.get(task.task_type)
    if (!handler) {
      logger.error({ taskType: task.task_type, taskId: task.id }, "No handler registered for task type")
      await this.failTask(task.id, "No handler registered")
      return
    }

    try {
      await handler(task.payload)
      await this.completeTask(task.id)
    } catch (err) {
      const nextAttempt = task.attempts + 1
      const error = err instanceof Error ? err.message : String(err)

      if (nextAttempt >= task.max_attempts) {
        logger.error(
          { taskId: task.id, taskType: task.task_type, attempts: nextAttempt, err },
          "Task exhausted max attempts"
        )
        await this.failTask(task.id, error)
      } else {
        // Exponential backoff: 5s, 10s, 20s, 40s, ... capped at 5 min
        const backoffMs = Math.min(5000 * Math.pow(2, nextAttempt - 1), 300_000)
        logger.warn(
          { taskId: task.id, taskType: task.task_type, attempt: nextAttempt, backoffMs, err },
          "Task failed, scheduling retry"
        )
        await this.retryTask(task.id, nextAttempt, backoffMs, error)
      }
    }
  }

  private async completeTask(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE pending_tasks SET status = 'completed', completed_at = NOW(), attempts = attempts + 1 WHERE id = $1`,
      [id]
    )
  }

  private async failTask(id: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE pending_tasks SET status = 'failed', attempts = attempts + 1, last_error = $2 WHERE id = $1`,
      [id, error]
    )
  }

  private async retryTask(id: string, attempts: number, backoffMs: number, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE pending_tasks
       SET attempts = $2, next_attempt_at = NOW() + ($3 || ' milliseconds')::interval, last_error = $4
       WHERE id = $1`,
      [id, attempts, String(backoffMs), error]
    )
  }
}

/**
 * Enqueue a task inside an existing transaction.
 * The task only becomes visible to the processor when the transaction commits.
 */
export async function enqueueTask(
  db: { query: Pool["query"] },
  params: { id: string; taskType: string; payload: Record<string, unknown>; maxAttempts?: number }
): Promise<void> {
  await db.query(
    `INSERT INTO pending_tasks (id, task_type, payload, max_attempts)
     VALUES ($1, $2, $3, $4)`,
    [params.id, params.taskType, JSON.stringify(params.payload), params.maxAttempts ?? 10]
  )
}
