/**
 * Backfill Thread Names Script
 *
 * Finds all threads without a displayName and queues naming jobs for them.
 * These jobs will be processed by the naming worker when the server is running.
 *
 * Usage:
 *   cd apps/backend
 *   bun run scripts/backfill-thread-names.ts
 *
 * Options:
 *   --dry-run    Show what would be queued without actually inserting jobs
 *   --limit=N    Maximum number of threads to process (default: all)
 */

import { createDatabasePool, sql } from "../src/db"
import { QueueRepository, JobQueues, type NamingJobData } from "../src/lib/queue"
import { queueId } from "../src/lib/id"

interface UnnamedThread {
  id: string
  workspaceId: string
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const limitArg = args.find((a) => a.startsWith("--limit="))
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : null

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error("DATABASE_URL environment variable is required")
    process.exit(1)
  }

  console.log("Connecting to database...")
  const pool = createDatabasePool(connectionString, { max: 5 })

  try {
    // Find all threads without displayName
    console.log("Finding unnamed threads...")
    const query = limit
      ? sql`
          SELECT id, workspace_id
          FROM streams
          WHERE type = 'thread'
            AND display_name IS NULL
            AND archived_at IS NULL
          ORDER BY created_at ASC
          LIMIT ${limit}
        `
      : sql`
          SELECT id, workspace_id
          FROM streams
          WHERE type = 'thread'
            AND display_name IS NULL
            AND archived_at IS NULL
          ORDER BY created_at ASC
        `
    const result = await pool.query<{ id: string; workspace_id: string }>(query)

    const threads: UnnamedThread[] = result.rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
    }))

    console.log(`Found ${threads.length} unnamed threads`)

    if (threads.length === 0) {
      console.log("No work to do!")
      return
    }

    if (dryRun) {
      console.log("\nDry run - would queue jobs for:")
      for (const thread of threads.slice(0, 10)) {
        console.log(`  - ${thread.id} (workspace: ${thread.workspaceId})`)
      }
      if (threads.length > 10) {
        console.log(`  ... and ${threads.length - 10} more`)
      }
      return
    }

    // Queue naming jobs
    console.log("\nQueuing naming jobs...")
    const now = new Date()
    let queued = 0

    for (const thread of threads) {
      const jobData: NamingJobData = {
        workspaceId: thread.workspaceId,
        streamId: thread.id,
        requireName: false,
      }

      await QueueRepository.insert(pool, {
        id: queueId(),
        queueName: JobQueues.NAMING_GENERATE,
        workspaceId: thread.workspaceId,
        payload: jobData,
        processAfter: now,
        insertedAt: now,
      })

      queued++
      if (queued % 100 === 0) {
        console.log(`  Queued ${queued}/${threads.length}...`)
      }
    }

    console.log(`\nDone! Queued ${queued} naming jobs.`)
    console.log("Jobs will be processed when the server is running.")
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
