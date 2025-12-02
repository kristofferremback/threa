/**
 * Backfill enrichment for existing messages with embeddings.
 * Run with: bun scripts/backfill-enrichment.ts
 */
import { createDatabasePool } from "../src/server/lib/db"
import { initJobQueue } from "../src/server/lib/job-queue"
import { backfillEnrichment } from "../src/server/workers/enrichment-worker"
import { DATABASE_URL } from "../src/server/config"

async function main() {
  console.log("Starting enrichment backfill...")

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

  console.log(`Backfilling enrichment for workspace: ${workspaceId}`)

  const result = await backfillEnrichment(pool, workspaceId, { limit: 500 })

  console.log(`Queued ${result.queued} enrichment jobs`)
  console.log("Done! Jobs will be processed by the enrichment worker.")

  await pool.end()
  process.exit(0)
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
