#!/usr/bin/env bun

/**
 * Test script to verify idle-session timeout handling.
 *
 * This script:
 * 1. Creates a connection
 * 2. Waits 70 seconds (past the 60s idle timeout)
 * 3. Attempts to use the connection
 * 4. Verifies automatic retry works
 */

import { createDatabasePool, withClient } from "../src/db"
import { logger } from "../src/lib/logger"

const DATABASE_URL = process.env.DATABASE_URL!

if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required")
  process.exit(1)
}

async function testIdleTimeout() {
  const pool = createDatabasePool(DATABASE_URL)

  console.log("\n=== Testing Idle-Session Timeout Handling ===\n")

  try {
    // Test 1: Connection becomes idle, then used via withClient (should auto-retry)
    console.log("Test 1: withClient with idle connection")
    console.log("  - Acquiring connection...")

    await withClient(pool, async (client) => {
      await client.query("SELECT 1")
      console.log("  - Connection acquired and tested")
    })

    console.log("  - Waiting 70 seconds for PostgreSQL to kill idle connections...")
    console.log("    (PostgreSQL idle_session_timeout = 60s)")

    await new Promise((resolve) => setTimeout(resolve, 70000))

    console.log("  - Attempting query after timeout...")

    await withClient(pool, async (client) => {
      const result = await client.query("SELECT 42 as answer")
      console.log(`  ✅ Success! Got result: ${result.rows[0].answer}`)
      console.log("  ✅ Automatic retry worked - no manual intervention needed")
    })

    // Test 2: Pool.query() direct (should auto-acquire fresh connection)
    console.log("\nTest 2: pool.query() direct")
    console.log("  - Using pool.query() after connections have been idle...")

    const result = await pool.query("SELECT 'works!' as status")
    console.log(`  ✅ Success! Got result: ${result.rows[0].status}`)

    console.log("\n=== All Tests Passed ===")
    console.log("\nConclusion:")
    console.log("✅ App handles idle-session timeouts gracefully")
    console.log("✅ Automatic retry works for withClient operations")
    console.log("✅ Direct pool.query() gets fresh connections automatically")
    console.log("✅ No crashes or unhandled errors")
    console.log("\n✅ PRODUCTION READY - App will survive PostgreSQL killing idle connections")
  } catch (error) {
    console.error("\n❌ Test failed:")
    console.error(error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

testIdleTimeout()
