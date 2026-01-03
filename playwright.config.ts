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
  reporter: process.env.CI ? "github" : "list",
  timeout: 60000, // 60s per test (auth flows can be slow)

  use: {
    baseURL: "http://localhost:3000",
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
  webServer: [
    {
      command: "bun run test:browser:backend",
      url: "http://localhost:3002/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      env: {
        PORT: "3002",
        DATABASE_URL: "postgresql://threa:threa@localhost:5454/threa_browser_test",
        USE_STUB_AUTH: "true",
        USE_STUB_COMPANION: "true",
        USE_STUB_BOUNDARY_EXTRACTION: "true",
        USE_STUB_AI: "true",
      },
    },
    {
      command: "bun run test:browser:frontend",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      env: {
        VITE_BACKEND_PORT: "3002",
      },
    },
  ],
})
