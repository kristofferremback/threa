import { describe, test, expect, afterAll } from "bun:test"
import { spawn, type Subprocess } from "bun"

const TEST_PORT = 3098 // Use different port from other e2e tests
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || "postgresql://threa:threa@localhost:5433/threa_test"
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"

describe("E2E: Server Startup", () => {
  let serverProcess: Subprocess<"ignore", "pipe", "pipe"> | null = null

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill()
      await serverProcess.exited
    }
  })

  test("should start server and respond to health check", async () => {
    // Start the server as a subprocess with test environment
    serverProcess = spawn({
      cmd: ["bun", "src/server/index.ts"],
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        DATABASE_URL: TEST_DATABASE_URL,
        REDIS_URL: REDIS_URL,
        NODE_ENV: "test",
        // WorkOS credentials - using dummy values for startup test
        // The server should start even if auth service fails to initialize
        WORKOS_API_KEY: "test_key",
        WORKOS_CLIENT_ID: "test_client_id",
      },
      stdout: "pipe",
      stderr: "pipe",
    })

    // Wait for server to be ready (poll health endpoint)
    const maxAttempts = 30
    const pollInterval = 200
    let healthy = false

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(`http://localhost:${TEST_PORT}/health`)
        if (response.ok) {
          const data = await response.json()
          expect(data.status).toBe("ok")
          expect(data.message).toBe("Threa API")
          healthy = true
          break
        }
      } catch {
        // Server not ready yet, wait and retry
        await new Promise((r) => setTimeout(r, pollInterval))
      }
    }

    expect(healthy).toBe(true)

    // Clean shutdown
    serverProcess.kill("SIGTERM")
    await serverProcess.exited
    serverProcess = null
  }, 15000) // 15 second timeout for server startup
})
