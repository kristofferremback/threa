/**
 * Global setup for browser E2E tests.
 *
 * Creates the test database and MinIO bucket before the backend server starts.
 * Uses docker exec to avoid needing pg/s3 modules at root level.
 */
import { execSync } from "child_process"

const TEST_DB_NAME = "threa_browser_test"
const POSTGRES_CONTAINER = "threa-postgres-1"
const MINIO_CONTAINER = "threa-minio-1"
const MINIO_BUCKET = "threa-browser-test"

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

async function ensureMinioBucket(): Promise<void> {
  try {
    // Check if bucket exists using mc (MinIO client) inside the container
    const result = execSync(`docker exec ${MINIO_CONTAINER} mc ls local/${MINIO_BUCKET} 2>&1 || true`, {
      encoding: "utf-8",
    })

    if (result.includes("does not exist")) {
      console.log(`Creating MinIO bucket: ${MINIO_BUCKET}`)
      execSync(`docker exec ${MINIO_CONTAINER} mc mb local/${MINIO_BUCKET}`, { encoding: "utf-8" })
    } else {
      console.log(`MinIO bucket exists: ${MINIO_BUCKET}`)
    }
  } catch (error) {
    // Bucket might already exist
    if (String(error).includes("already") || String(error).includes("exists")) {
      console.log(`MinIO bucket already exists: ${MINIO_BUCKET}`)
    } else {
      throw error
    }
  }
}

export default async function globalSetup(): Promise<void> {
  console.log("\n=== Browser E2E Global Setup ===\n")

  if (process.env.CI) {
    // In CI, database and bucket are created by the workflow before tests run
    console.log("CI environment detected - skipping local setup")
  } else {
    await ensureTestDatabase()
    await ensureMinioBucket()
  }

  console.log("=== Setup Complete ===\n")
}
