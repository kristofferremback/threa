import { Pool } from "pg"
import { sql } from "../lib/db"
import { getJobQueue, EmbedJobData, JobPriority } from "../lib/job-queue"
import { generateEmbeddingsBatch, calculateCost, Models } from "../lib/ai-providers"
import { AIUsageService } from "../services/ai-usage-service"
import { logger } from "../lib/logger"
import { getTextMessageEmbeddingTable, getEmbeddingProvider } from "../lib/embedding-tables"
import { queueImmediateEnrichment } from "./enrichment-worker"

/**
 * Embedding Worker - Processes embedding generation jobs.
 *
 * Listens for ai.embed jobs from the queue and generates vector embeddings
 * for text messages. Processes jobs in batches for efficiency.
 */
export class EmbeddingWorker {
  private usageService: AIUsageService
  private embeddingTable: string
  private provider: string
  private isRunning = false

  constructor(private pool: Pool) {
    this.usageService = new AIUsageService(pool)
    this.embeddingTable = getTextMessageEmbeddingTable()
    this.provider = getEmbeddingProvider()
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Embedding worker already running")
      return
    }

    logger.info({ embeddingTable: this.embeddingTable, provider: this.provider }, "Starting embedding worker")

    const boss = getJobQueue()

    await boss.work<EmbedJobData>(
      "ai.embed",
      {
        batchSize: 50,
        pollingIntervalSeconds: 2,
      },
      async (jobs) => {
        if (jobs.length === 0) return
        await this.processBatch(jobs)
      },
    )

    this.isRunning = true
    logger.info("Embedding worker started")
  }

  private async processBatch(jobs: Array<{ id: string; data: EmbedJobData }>): Promise<void> {
    logger.info({ count: jobs.length }, "Processing embedding batch")

    // Group by workspace to check AI enabled status
    const jobsByWorkspace = new Map<string, typeof jobs>()
    for (const job of jobs) {
      const existing = jobsByWorkspace.get(job.data.workspaceId) || []
      existing.push(job)
      jobsByWorkspace.set(job.data.workspaceId, existing)
    }

    for (const [workspaceId, workspaceJobs] of jobsByWorkspace) {
      try {
        const isEnabled = await this.usageService.isAIEnabled(workspaceId)
        if (!isEnabled) {
          logger.debug({ workspaceId }, "AI not enabled, skipping embeddings")
          continue
        }

        const validJobs = workspaceJobs.filter((j) => j.data.content && j.data.content.trim().length > 0)
        if (validJobs.length === 0) continue

        const texts = validJobs.map((j) => j.data.content)
        const embeddings = await generateEmbeddingsBatch(texts)

        for (let i = 0; i < validJobs.length; i++) {
          const job = validJobs[i]
          const embedding = embeddings[i]

          await this.pool.query(
            sql`INSERT INTO ${sql.raw(this.embeddingTable)} (text_message_id, embedding, model)
              VALUES (${job.data.textMessageId}, ${JSON.stringify(embedding.embedding)}::vector, ${embedding.model})
              ON CONFLICT (text_message_id) DO UPDATE
              SET embedding = EXCLUDED.embedding, model = EXCLUDED.model, created_at = NOW()`,
          )

          const isLocalModel = !embedding.model.startsWith("text-embedding")
          await this.usageService.trackUsage({
            workspaceId: job.data.workspaceId,
            jobType: "embed",
            model: embedding.model,
            inputTokens: embedding.tokens,
            costCents: isLocalModel ? 0 : calculateCost(Models.EMBEDDING, { inputTokens: embedding.tokens }),
            eventId: job.data.eventId,
            jobId: job.id,
          })

          // Queue immediate enrichment after embedding (eager indexing)
          if (job.data.eventId) {
            await queueImmediateEnrichment({
              workspaceId: job.data.workspaceId,
              textMessageId: job.data.textMessageId,
              eventId: job.data.eventId,
            })
          }
        }

        logger.info({ workspaceId, count: validJobs.length }, "Embeddings stored and enrichment queued")
      } catch (err) {
        logger.error({ err, workspaceId }, "Failed to process embeddings for workspace")
        throw err
      }
    }
  }
}

/**
 * Queue an embedding job for a text message.
 */
export async function queueEmbedding(params: {
  workspaceId: string
  textMessageId: string
  content: string
  eventId?: string
}): Promise<string | null> {
  const boss = getJobQueue()

  if (params.content.trim().length < 20) {
    logger.debug({ textMessageId: params.textMessageId }, "Content too short, skipping embedding")
    return null
  }

  return await boss.send(
    "ai.embed",
    {
      workspaceId: params.workspaceId,
      textMessageId: params.textMessageId,
      content: params.content,
      eventId: params.eventId,
    } satisfies EmbedJobData,
    {
      priority: JobPriority.NORMAL,
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
    },
  )
}

/**
 * Backfill embeddings for existing messages that don't have them.
 */
export async function backfillEmbeddings(
  pool: Pool,
  workspaceId: string,
  options: { batchSize?: number; limit?: number } = {},
): Promise<{ queued: number; skipped: number }> {
  const batchSize = options.batchSize ?? 100
  const limit = options.limit ?? 10000
  const embeddingTable = getTextMessageEmbeddingTable()

  const result = await pool.query<{
    id: string
    content: string
    event_id: string
  }>(
    sql`SELECT tm.id, tm.content, e.id as event_id
      FROM text_messages tm
      INNER JOIN stream_events e ON e.content_id = tm.id
      INNER JOIN streams s ON e.stream_id = s.id
      LEFT JOIN ${sql.raw(embeddingTable)} emb ON emb.text_message_id = tm.id
      WHERE s.workspace_id = ${workspaceId}
        AND emb.text_message_id IS NULL
        AND tm.content IS NOT NULL
        AND LENGTH(tm.content) >= 20
      ORDER BY e.created_at DESC
      LIMIT ${limit}`,
  )

  let queued = 0
  let skipped = 0

  for (const row of result.rows) {
    const jobId = await queueEmbedding({
      workspaceId,
      textMessageId: row.id,
      content: row.content,
      eventId: row.event_id,
    })

    if (jobId) {
      queued++
    } else {
      skipped++
    }

    if (queued > 0 && queued % batchSize === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  logger.info({ workspaceId, queued, skipped }, "Backfill embeddings queued")
  return { queued, skipped }
}
