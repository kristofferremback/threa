import { describe, test, expect, afterAll, beforeAll } from "bun:test"
import { spawn, type Subprocess } from "bun"

const TEST_PORT = 3098 // Use different port from other e2e tests
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || "postgresql://threa:threa@localhost:5433/threa_test"
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"
const BASE_URL = `http://localhost:${TEST_PORT}`

// Skip in CI - this test spawns a real server process which can be flaky in CI environments
const isCI = process.env.CI === "true"
const testFn = isCI ? test.skip : test

describe("E2E: Blackbox Server", () => {
  let serverProcess: Subprocess | null = null

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill()
      await serverProcess.exited
    }
  })

  testFn(
    "should start server with 'bun start' and execute real API calls",
    async () => {
      // Start the server using the actual production command with stub auth
      // Use inherit for stdout/stderr to avoid buffering issues
      serverProcess = spawn({
        cmd: ["bun", "run", "start"],
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          PORT: String(TEST_PORT),
          DATABASE_URL: TEST_DATABASE_URL,
          REDIS_URL: REDIS_URL,
          USE_STUB_AUTH: "true", // Enable stub auth for testing
        },
        stdout: "inherit",
        stderr: "inherit",
      }) as any

      // Wait for server to be ready (poll health endpoint)
      const maxAttempts = 30
      const pollInterval = 200
      let healthy = false

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const response = await fetch(`${BASE_URL}/health`)
          if (response.ok) {
            healthy = true
            break
          }
        } catch {
          await new Promise((r) => setTimeout(r, pollInterval))
        }
      }

      if (!healthy) {
        console.error("Server failed to become healthy")
      }

      expect(healthy).toBe(true)

      // Test health endpoint
      const healthRes = await fetch(`${BASE_URL}/health`)
      const healthData = await healthRes.json()
      expect(healthData.status).toBe("ok")
      expect(healthData.message).toBe("Threa API")

      // Small delay to ensure server is fully ready
      await new Promise((r) => setTimeout(r, 500))

      // Register a test user via the stub auth endpoint
      const registerRes = await fetch(`${BASE_URL}/api/test/register-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "blackbox_test_user_1",
          email: "blackbox@test.com",
          firstName: "Blackbox",
          lastName: "Tester",
        }),
      })
      expect(registerRes.status).toBe(200)
      const { sessionToken } = await registerRes.json()
      expect(sessionToken).toBe("test_session_blackbox_test_user_1")

      // Test authenticated endpoint - /api/auth/me
      const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Cookie: `wos_session=${sessionToken}` },
      })
      expect(meRes.status).toBe(200)
      const meData = await meRes.json()
      expect(meData.email).toBe("blackbox@test.com")

      // Test unauthenticated request should redirect
      const unauthRes = await fetch(`${BASE_URL}/api/workspace/ws_123/streams/browse`, {
        redirect: "manual",
      })
      expect(unauthRes.status).toBe(302)

      // Clean shutdown
      if (serverProcess) {
        serverProcess.kill("SIGTERM")
        await serverProcess.exited
        serverProcess = null
      }
    },
    20000,
  ) // 20 second timeout
})
