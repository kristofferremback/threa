/**
 * Global setup for browser E2E tests.
 *
 * Creates the test database (worktree-specific) and MinIO bucket before servers start.
 * Port allocation is handled in playwright.config.ts.
 * Uses docker exec to avoid needing pg/s3 modules at root level.
 */
import { execSync } from "child_process"
import * as path from "path"

const MINIO_CONTAINER = "threa-minio-1"
const MINIO_BUCKET = "threa-browser-test"

/**
 * Derive a unique database name from the current directory.
 * Same logic as playwright.config.ts and setup-worktree.ts for consistency.
 */
function deriveTestDatabaseName(): string {
  const cwd = process.cwd()
  const dirName = path.basename(cwd)
  const sanitized = dirName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")

  return `${sanitized || "threa"}_browser_test`
}

/**
 * Find a running postgres container by name pattern.
 */
function findPostgresContainer(): string | null {
  try {
    const result = execSync("docker ps --format '{{.Names}}' --filter 'name=postgres'", {
      encoding: "utf-8",
    }).trim()
    const containers = result.split("\n").filter(Boolean)
    return containers.find((c) => c.startsWith("threa-postgres")) || containers[0] || null
  } catch {
    return null
  }
}

async function ensureTestDatabase(dbName: string, container: string): Promise<void> {
  try {
    // Check if database exists
    const result = execSync(
      `docker exec ${container} psql -U threa -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${dbName}'"`,
      { encoding: "utf-8" }
    ).trim()

    if (result !== "1") {
      console.log(`Creating test database: ${dbName}`)
      execSync(`docker exec ${container} psql -U threa -d postgres -c "CREATE DATABASE ${dbName}"`, {
        encoding: "utf-8",
      })
    } else {
      console.log(`Test database exists: ${dbName}`)
    }
  } catch (error) {
    // Database might already exist (race condition)
    if (String(error).includes("already exists")) {
      console.log(`Test database already exists: ${dbName}`)
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

  // Derive worktree-specific database name
  const dbName = deriveTestDatabaseName()
  console.log(`Test database name: ${dbName}`)

  if (process.env.CI) {
    // In CI, database and bucket are created by the workflow before tests run
    console.log("CI environment detected - skipping local setup")
  } else {
    const container = findPostgresContainer()
    if (!container) {
      throw new Error("No running postgres container found. Run 'bun run db:start' first.")
    }
    console.log(`Using postgres container: ${container}`)
    await ensureTestDatabase(dbName, container)
    await ensureMinioBucket()
  }

  console.log("=== Setup Complete ===\n")
}
