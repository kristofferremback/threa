/**
 * Test server module - starts the backend with test configuration.
 *
 * Sets environment variables for:
 * - Separate test database (threa_test)
 * - Random available port
 * - Stub auth enabled
 *
 * Then starts the normal server with those settings.
 */

import { createServer } from "http"
import { Pool } from "pg"

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
 * Cleans up stale jobs from previous test runs to prevent test pollution.
 */
async function cleanupStaleJobs(): Promise<void> {
  const testPool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL || "postgresql://threa:threa@localhost:5454/threa_test",
  })

  try {
    // Delete old pg-boss jobs to prevent queue pollution
    await testPool.query("DELETE FROM pgboss.job WHERE state IN ('created', 'retry', 'active')")
    // Also clean up archived jobs to prevent bloat
    await testPool.query("DELETE FROM pgboss.archive WHERE completedon < NOW() - INTERVAL '1 hour'")
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
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "postgresql://threa:threa@localhost:5454/threa_test"
  process.env.PORT = String(port)
  process.env.USE_STUB_AUTH = "true"
  process.env.USE_STUB_COMPANION = "true"

  // Import and start the server (must be after env vars are set)
  const { startServer } = await import("../src/server")
  const instance = await startServer()

  return {
    url: `http://localhost:${port}`,
    port,
    stop: instance.stop,
  }
}
