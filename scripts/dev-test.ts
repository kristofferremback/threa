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

    // Load backend .env file explicitly (Bun only auto-loads from CWD)
    const backendEnvPath = path.join(process.cwd(), "apps/backend/.env")
    let backendEnv: Record<string, string> = {}

    if (fs.existsSync(backendEnvPath)) {
      const envContent = fs.readFileSync(backendEnvPath, "utf-8")
      for (const line of envContent.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue
        const [key, ...valueParts] = trimmed.split("=")
        if (key && valueParts.length > 0) {
          backendEnv[key] = valueParts.join("=")
        }
      }
    }

    // Set environment variables for test mode
    const env = {
      ...backendEnv, // Load from apps/backend/.env
      ...process.env, // Override with process env
      DATABASE_URL: `postgresql://threa:threa@localhost:5454/${TEST_DB_NAME}`,
      USE_STUB_AUTH: "true",
      FAST_SHUTDOWN: "true",
    }

    console.log("\nStarting dev server in test mode:")
    console.log(`  - Database: ${TEST_DB_NAME}`)
    console.log(`  - Stub Auth: enabled`)
    console.log(`  - Frontend: http://localhost:3000`)
    console.log(`  - Backend: http://localhost:3001\n`)

    // Run backend without --hot (more stable for testing)
    const backend = Bun.spawn(["bun", "apps/backend/src/index.ts"], {
      stdout: "inherit",
      stderr: "inherit",
      env,
    })

    const frontend = Bun.spawn(["bun", "run", "--cwd", "apps/frontend", "dev"], {
      stdout: "inherit",
      stderr: "inherit",
    })

    // Handle shutdown
    let isShuttingDown = false
    const shutdown = async () => {
      if (isShuttingDown) return
      isShuttingDown = true
      console.log("\nShutting down test server...")
      backend.kill("SIGKILL")
      frontend.kill("SIGKILL")
      await Promise.all([backend.exited, frontend.exited])
      process.exit(0)
    }

    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)

    await Promise.all([backend.exited, frontend.exited])
  } catch (err) {
    console.error("Failed to start test server:", err)
    process.exit(1)
  }
}

main()
