/**
 * Global setup for browser E2E tests.
 *
 * Creates the test database before the backend server starts.
 * Uses docker exec to avoid needing pg module at root level.
 *
 * Note: MinIO bucket is created automatically by the backend on startup.
 */
import { execSync } from "child_process"

const TEST_DB_NAME = "threa_browser_test"
const POSTGRES_CONTAINER = "threa-postgres-1"

async function ensureTestDatabase(): Promise<void> {
  try {
    // Check if database exists
    const result = execSync(
      `docker exec ${POSTGRES_CONTAINER} psql -U threa -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${TEST_DB_NAME}'"`,
      { encoding: "utf-8" }
    ).trim()

    if (result !== "1") {
      console.log(`Creating test database: ${TEST_DB_NAME}`)
      execSync(`docker exec ${POSTGRES_CONTAINER} psql -U threa -d postgres -c "CREATE DATABASE ${TEST_DB_NAME}"`, {
        encoding: "utf-8",
      })
    } else {
      console.log(`Test database exists: ${TEST_DB_NAME}`)
    }
  } catch (error) {
    // Database might already exist (race condition)
    if (String(error).includes("already exists")) {
      console.log(`Test database already exists: ${TEST_DB_NAME}`)
    } else {
      throw error
    }
  }
}

export default async function globalSetup(): Promise<void> {
  console.log("\n=== Browser E2E Global Setup ===\n")

  if (process.env.CI) {
    // In CI, database is created by the workflow before tests run
    console.log("CI environment detected - skipping local database setup")
  } else {
    await ensureTestDatabase()
  }

  console.log("=== Setup Complete ===\n")
}
