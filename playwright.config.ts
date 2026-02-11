import { defineConfig, devices } from "@playwright/test"
import * as path from "path"
import * as net from "net"

/**
 * Test infrastructure ports.
 * - CI: Uses ports 5454/9000 (configured in GitHub Actions workflow)
 * - Local: Uses docker-compose.test.yml with separate ports to avoid dev conflicts
 */
const isCI = !!process.env.CI
const DB_PORT = isCI ? 5454 : 5455
const MINIO_PORT = isCI ? 9000 : 9002

/**
 * Derive a unique database name from the current directory.
 * Same logic as setup-worktree.ts for consistency.
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
 * Find a free port synchronously using a temporary server.
 * This is a bit hacky but necessary since playwright config is synchronous.
 */
function findFreePortSync(): number {
  const server = net.createServer()
  server.listen(0)
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  server.close()
  return port
}

/**
 * Get or allocate a port, caching in environment variables.
 * Playwright re-evaluates config in worker processes - we need stable ports.
 */
function getOrAllocatePort(envVar: string): number {
  if (process.env[envVar]) {
    return parseInt(process.env[envVar]!, 10)
  }
  const port = findFreePortSync()
  process.env[envVar] = String(port)
  return port
}

// Find free ports for this test run (allows parallel execution across worktrees)
// Ports are cached in env vars so worker processes use the same ports
const backendPort = getOrAllocatePort("PLAYWRIGHT_BACKEND_PORT")
const frontendPort = getOrAllocatePort("PLAYWRIGHT_FRONTEND_PORT")
const dbName = deriveTestDatabaseName()

// Only log once (when ports are first allocated)
if (!process.env.PLAYWRIGHT_PORTS_LOGGED) {
  console.log(
    `Playwright config: backend=${backendPort}, frontend=${frontendPort}, db=${dbName}, postgres=${DB_PORT}, minio=${MINIO_PORT}`
  )
  process.env.PLAYWRIGHT_PORTS_LOGGED = "true"
}

/**
 * Playwright configuration for browser E2E tests.
 *
 * These tests run against a real backend + frontend with a fresh test database.
 * The webServer config starts both servers before tests run.
 *
 * Ports are dynamically allocated to allow parallel test runs across worktrees.
 */
export default defineConfig({
  testDir: "./tests/browser",
  globalSetup: "./tests/browser/global-setup.ts",
  fullyParallel: true, // Each test creates unique user + workspace — safe to parallelize
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined, // CI: 4 parallel workers; local: auto (half CPU cores)
  reporter: process.env.CI ? [["github"], ["line"], ["html", { open: "never" }]] : "list",
  timeout: 30000, // 30s per test

  use: {
    baseURL: `http://localhost:${frontendPort}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Start both backend and frontend before running tests
  // Ports are dynamically allocated to avoid conflicts with other worktrees
  webServer: [
    {
      command: "bun run test:browser:backend",
      url: `http://localhost:${backendPort}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      env: {
        PORT: String(backendPort),
        DATABASE_URL: `postgresql://threa:threa@localhost:${DB_PORT}/${dbName}`,
        USE_STUB_AUTH: "true",
        USE_STUB_COMPANION: "true",
        USE_STUB_BOUNDARY_EXTRACTION: "true",
        USE_STUB_AI: "true",
        THREA_TEST_LOG_FILE: process.env.THREA_TEST_LOG_FILE,
        // MinIO S3-compatible storage for file uploads
        S3_BUCKET: "threa-browser-test",
        S3_REGION: "us-east-1",
        S3_ACCESS_KEY_ID: "minioadmin",
        S3_SECRET_ACCESS_KEY: "minioadmin",
        S3_ENDPOINT: `http://localhost:${MINIO_PORT}`,
        // Security hardening: allow test origins through CORS, disable rate limits
        CORS_ALLOWED_ORIGINS: `http://localhost:${backendPort},http://localhost:${frontendPort}`,
        GLOBAL_RATE_LIMIT_MAX: "10000",
        AUTH_RATE_LIMIT_MAX: "10000",
      },
    },
    {
      command: "bun run test:browser:frontend",
      url: `http://localhost:${frontendPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      env: {
        VITE_BACKEND_PORT: String(backendPort),
        VITE_PORT: String(frontendPort),
      },
    },
  ],
})
