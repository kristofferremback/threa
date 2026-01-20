import { $ } from "bun"
import * as fs from "fs"
import * as path from "path"

const TEST_DB_NAME = "threa_test"

async function findPostgresContainer(): Promise<string | null> {
  const result = await $`docker ps --format '{{.Names}}' --filter 'name=threa-postgres'`.quiet().nothrow()
  const containers = result.stdout.toString().trim().split("\n").filter(Boolean)
  return containers[0] || null
}

async function createTestDatabase(): Promise<void> {
  console.log(`Checking if test database '${TEST_DB_NAME}' exists...`)

  const container = await findPostgresContainer()
  if (!container) {
    throw new Error("No running postgres container found. Run 'bun run db:start' first to start the database.")
  }

  console.log(`Using postgres container: ${container}`)

  // Check if database exists
  const checkResult =
    await $`docker exec ${container} psql -U threa -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${TEST_DB_NAME}'"`
      .quiet()
      .nothrow()

  if (checkResult.stdout.toString().trim() === "1") {
    console.log(`Test database '${TEST_DB_NAME}' already exists`)
  } else {
    console.log(`Creating test database '${TEST_DB_NAME}'...`)
    await $`docker exec ${container} psql -U threa -d postgres -c "CREATE DATABASE ${TEST_DB_NAME}"`
    console.log(`Test database '${TEST_DB_NAME}' created`)
  }
}

async function main() {
  try {
    // Create test database if it doesn't exist
    await createTestDatabase()

    // Set environment variables for test mode
    const env = {
      ...process.env,
      DATABASE_URL: `postgresql://threa:threa@localhost:5454/${TEST_DB_NAME}`,
      USE_STUB_AUTH: "true",
      FAST_SHUTDOWN: "true",
    }

    console.log("\nStarting dev server in test mode:")
    console.log(`  - Database: ${TEST_DB_NAME}`)
    console.log(`  - Stub Auth: enabled`)
    console.log(`  - Frontend: http://localhost:3000`)
    console.log(`  - Backend: http://localhost:3001\n`)

    // Run the dev script with test environment
    await $`bun scripts/dev.ts`.env(env)
  } catch (err) {
    console.error("Failed to start test server:", err)
    process.exit(1)
  }
}

main()
