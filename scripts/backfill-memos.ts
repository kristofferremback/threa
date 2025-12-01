/**
 * Backfill memo evaluation for existing enriched messages.
 * Run with: bun scripts/backfill-memos.ts
 */
import { createDatabasePool } from "../src/server/lib/db"
import { initJobQueue } from "../src/server/lib/job-queue"
import { backfillMemoEvaluation } from "../src/server/workers/memo-worker"
import { DATABASE_URL } from "../src/server/config"

async function main() {
  console.log("Starting memo evaluation backfill...")

  const pool = createDatabasePool()

  // Initialize job queue
  await initJobQueue(DATABASE_URL)

  // Get workspace ID
  const workspaceResult = await pool.query<{ id: string }>("SELECT id FROM workspaces LIMIT 1")
  const workspaceId = workspaceResult.rows[0]?.id

  if (!workspaceId) {
    console.error("No workspace found!")
    process.exit(1)
  }

  // Check how many enriched messages exist
  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM stream_events e
     INNER JOIN text_messages tm ON e.content_id = tm.id AND e.content_type = 'text_message'
     INNER JOIN streams s ON e.stream_id = s.id
     WHERE s.workspace_id = $1
       AND tm.enrichment_tier >= 2
       AND e.deleted_at IS NULL`,
    [workspaceId],
  )

  const enrichedCount = parseInt(countResult.rows[0]?.count || "0", 10)
  console.log(`Found ${enrichedCount} enriched messages in workspace: ${workspaceId}`)

  // Check existing memos
  const memoCountResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM memos WHERE workspace_id = $1 AND archived_at IS NULL`,
    [workspaceId],
  )
  const existingMemos = parseInt(memoCountResult.rows[0]?.count || "0", 10)
  console.log(`Existing memos: ${existingMemos}`)

  console.log(`Backfilling memo evaluation for workspace: ${workspaceId}`)

  const result = await backfillMemoEvaluation(pool, workspaceId, { limit: 500 })

  console.log(`Queued ${result.queued} memo evaluation jobs`)
  console.log("Done! Jobs will be processed by the memo worker.")

  await pool.end()
  process.exit(0)
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
