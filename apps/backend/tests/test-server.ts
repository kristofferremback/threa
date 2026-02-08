/**
 * Test server module - starts the backend with test configuration.
 *
 * Sets environment variables for:
 * - Separate test database (threa_test)
 * - Random available port
 * - Stub auth enabled
 * - S3/MinIO configuration
 *
 * Then starts the normal server with those settings.
 */

import { createServer } from "http"
import { Pool } from "pg"
import { S3Client, HeadBucketCommand, CreateBucketCommand } from "@aws-sdk/client-s3"

export interface TestServer {
  url: string
  port: number
  stop: () => Promise<void>
}

/**
 * Creates the test database if it doesn't exist.
 */
async function ensureTestDatabaseExists(): Promise<void> {
  const adminPool = new Pool({
    connectionString: "postgresql://threa:threa@localhost:5454/postgres",
  })

  try {
    const result = await adminPool.query("SELECT 1 FROM pg_database WHERE datname = 'threa_test'")

    if (result.rows.length === 0) {
      await adminPool.query("CREATE DATABASE threa_test")
    }
  } finally {
    await adminPool.end()
  }
}

/**
 * Ensures the MinIO bucket exists for file upload tests.
 */
async function ensureMinioBucketExists(): Promise<void> {
  const bucket = process.env.S3_BUCKET || "threa-test-uploads"
  const endpoint = process.env.S3_ENDPOINT || "http://localhost:9099"

  const client = new S3Client({
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || "minioadmin",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "minioadmin",
    },
  })

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }))
  } catch (err: unknown) {
    const error = err as { name?: string }
    if (error.name === "NotFound" || error.name === "NoSuchBucket") {
      await client.send(new CreateBucketCommand({ Bucket: bucket }))
      console.log(`Created MinIO bucket: ${bucket}`)
    } else {
      throw err
    }
  } finally {
    client.destroy()
  }
}

/**
 * Cleans up stale jobs from previous test runs to prevent test pollution.
 */
async function cleanupStaleJobs(): Promise<void> {
  const testPool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL || "postgresql://threa:threa@localhost:5454/threa_test",
  })

  try {
    // Reset mutable application data so every e2e run starts from a clean slate.
    // Keep static seed/migration tables (for example personas, umzug_migrations) intact.
    await testPool.query(`
      TRUNCATE TABLE
        agent_session_steps,
        agent_sessions,
        ai_alerts,
        ai_budgets,
        ai_usage_records,
        ai_user_quotas,
        attachment_extractions,
        attachments,
        conversations,
        cron_schedules,
        cron_ticks,
        emoji_usage,
        file_chunks,
        memo_pending_items,
        memo_stream_state,
        memos,
        messages,
        outbox,
        outbox_dead_letters,
        outbox_listeners,
        pdf_page_extractions,
        pdf_processing_jobs,
        queue_messages,
        queue_tokens,
        reactions,
        researcher_cache,
        socket_io_attachments,
        stream_events,
        stream_members,
        stream_persona_participants,
        stream_persona_roster,
        stream_sequences,
        streams,
        user_preference_overrides,
        users,
        workspace_members,
        workspaces
      RESTART IDENTITY CASCADE
    `)

    // Legacy pg-boss tables can still contain stale rows from prior test/dev runs.
    await testPool.query("DELETE FROM pgboss.job")
    await testPool.query("DELETE FROM pgboss.archive")
  } catch {
    // Ignore errors if tables don't exist yet
  } finally {
    await testPool.end()
  }
}

/**
 * Finds a random available port.
 */
async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, () => {
      const address = server.address()
      if (address && typeof address === "object") {
        const port = address.port
        server.close(() => resolve(port))
      } else {
        reject(new Error("Could not get server address"))
      }
    })
    server.on("error", reject)
  })
}

/**
 * Starts a test server with isolated configuration.
 */
export async function startTestServer(): Promise<TestServer> {
  await ensureTestDatabaseExists()
  await cleanupStaleJobs()

  const port = await findAvailablePort()

  // Configure environment for test server
  process.env.FAST_SHUTDOWN = "true" // Fast shutdown for tests
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "postgresql://threa:threa@localhost:5454/threa_test"
  process.env.PORT = String(port)
  process.env.USE_STUB_AUTH = "true"
  process.env.USE_STUB_COMPANION = "true"
  process.env.USE_STUB_BOUNDARY_EXTRACTION = "true"
  process.env.USE_STUB_AI = "true"

  // Higher throughput for parallel test files
  process.env.QUEUE_MAX_ACTIVE_TOKENS = "15"
  process.env.QUEUE_POLL_INTERVAL_MS = "100"
  process.env.DATABASE_POOL_MAX = "50"
  process.env.GLOBAL_RATE_LIMIT_MAX = "10000"

  // S3/MinIO configuration for file upload tests
  // Use a test-specific bucket name to avoid conflicts with local development
  process.env.S3_BUCKET = process.env.S3_BUCKET || "threa-test-uploads"
  process.env.S3_REGION = process.env.S3_REGION || "us-east-1"
  process.env.S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || "minioadmin"
  process.env.S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || "minioadmin"
  process.env.S3_ENDPOINT = process.env.S3_ENDPOINT || "http://localhost:9099"

  // Ensure MinIO bucket exists
  await ensureMinioBucketExists()

  // Import and start the server (must be after env vars are set)
  const { startServer } = await import("../src/server")
  const instance = await startServer()

  return {
    url: `http://localhost:${port}`,
    port,
    stop: instance.stop,
  }
}
