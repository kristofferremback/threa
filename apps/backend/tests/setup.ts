/**
 * Test setup - starts the server before all tests and stops it after.
 *
 * This file is loaded via bun test --preload. It:
 * 1. Starts a test server on a random port with a separate test database
 * 2. Exports the server URL for use in test files
 * 3. Cleans up the server after all tests complete
 */

import { beforeAll, afterAll } from "bun:test"
import { startTestServer, TestServer } from "./test-server"

let testServer: TestServer | null = null

// Export a getter for the base URL - tests should use this
export function getBaseUrl(): string {
  if (!testServer) {
    throw new Error("Test server not started. Ensure setup.ts is loaded via --preload")
  }
  return testServer.url
}

// Global setup - runs once before all test files
beforeAll(async () => {
  testServer = await startTestServer()
  // Set environment variable so client.ts can pick it up
  process.env.TEST_BASE_URL = testServer.url
  console.log(`Test server started at ${testServer.url}`)
})

// Global teardown - runs once after all test files
afterAll(async () => {
  if (testServer) {
    console.log("Stopping test server...")
    await testServer.stop()
    testServer = null
  }
})
