import { defineConfig, devices } from "@playwright/test"

/**
 * Playwright configuration for browser E2E tests.
 *
 * These tests run against a real backend + frontend with a fresh test database.
 * The webServer config starts both servers before tests run.
 */
export default defineConfig({
  testDir: "./tests/browser",
  globalSetup: "./tests/browser/global-setup.ts",
  fullyParallel: false, // Run tests sequentially to avoid DB conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for sequential execution
  reporter: process.env.CI ? [["github"], ["line"], ["html", { open: "never" }]] : "list",
  timeout: 30000, // 30s per test

  use: {
    baseURL: "http://localhost:3900",
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
  // Uses 39xx ports to avoid conflicts with dev servers (3xxx)
  webServer: [
    {
      command: "bun run test:browser:backend",
      url: "http://localhost:3902/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      env: {
        PORT: "3902",
        DATABASE_URL: "postgresql://threa:threa@localhost:5454/threa_browser_test",
        USE_STUB_AUTH: "true",
        USE_STUB_COMPANION: "true",
        USE_STUB_BOUNDARY_EXTRACTION: "true",
        USE_STUB_AI: "true",
        // MinIO S3-compatible storage for file uploads
        S3_BUCKET: "threa-browser-test",
        S3_REGION: "us-east-1",
        S3_ACCESS_KEY_ID: "minioadmin",
        S3_SECRET_ACCESS_KEY: "minioadmin",
        S3_ENDPOINT: "http://localhost:9000",
      },
    },
    {
      command: "bun run test:browser:frontend",
      url: "http://localhost:3900",
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      env: {
        VITE_BACKEND_PORT: "3902",
        VITE_PORT: "3900",
      },
    },
  ],
})
