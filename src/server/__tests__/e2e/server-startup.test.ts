import { describe, test, expect, afterAll, beforeAll } from "bun:test"
import { spawn, type Subprocess } from "bun"

const TEST_PORT = 3098 // Use different port from other e2e tests
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || "postgresql://threa:threa@localhost:5433/threa_test"
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"

// Skip in CI - this test spawns a real server process which can be flaky in CI environments
const isCI = process.env.CI === "true"
const testFn = isCI ? test.skip : test

describe("E2E: Server Startup", () => {
  let serverProcess: Subprocess<"ignore", "pipe", "pipe"> | null = null

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill()
      await serverProcess.exited
    }
  })

  testFn("should start server and respond to health check", async () => {
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
        WORKOS_API_KEY: "sk_test_dummy",
        WORKOS_CLIENT_ID: "client_dummy",
        WORKOS_REDIRECT_URI: "http://localhost:3098/api/auth/callback",
        WORKOS_COOKIE_PASSWORD: "test_cookie_password_at_least_32_chars",
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

    if (!healthy && serverProcess) {
      // Capture output for debugging
      const stdout = await new Response(serverProcess.stdout).text()
      const stderr = await new Response(serverProcess.stderr).text()
      console.error("Server stdout:", stdout)
      console.error("Server stderr:", stderr)
    }

    expect(healthy).toBe(true)

    // Clean shutdown
    if (serverProcess) {
      serverProcess.kill("SIGTERM")
      await serverProcess.exited
      serverProcess = null
    }
  }, 15000) // 15 second timeout for server startup
})
