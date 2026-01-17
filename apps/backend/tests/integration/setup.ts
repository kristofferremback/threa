/**
 * Shared setup for integration tests.
 * Ensures the test database exists and provides connection helpers.
 */

import { Pool } from "pg"
import { createDatabasePool } from "../../src/db"
import { createMigrator } from "../../src/db/migrations"

const ADMIN_DATABASE_URL = "postgresql://threa:threa@localhost:5454/postgres"
const TEST_DATABASE_URL = "postgresql://threa:threa@localhost:5454/threa_test"

/**
 * Creates the test database if it doesn't exist.
 */
export async function ensureTestDatabaseExists(): Promise<void> {
  const adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL })

  try {
    const result = await adminPool.query("SELECT 1 FROM pg_database WHERE datname = 'threa_test'")

    if (result.rows.length === 0) {
      await adminPool.query("CREATE DATABASE threa_test")
    }
  } finally {
    await adminPool.end()
  }
}

/**
 * Creates a pool connected to the test database.
 */
export function createTestPool(): Pool {
  return createDatabasePool(process.env.TEST_DATABASE_URL ?? TEST_DATABASE_URL)
}

/**
 * Full setup: ensure database exists, connect, run migrations.
 * Returns the pool for use in tests.
 */
export async function setupTestDatabase(): Promise<Pool> {
  await ensureTestDatabaseExists()
  const pool = createTestPool()
  const migrator = createMigrator(pool)
  await migrator.up()
  return pool
}

/**
 * Creates a minimal ProseMirror JSON document from text.
 * Used in tests to construct contentJson field for messages.
 */
export function testContentJson(text: string) {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }
}

/**
 * Transforms a simple content string into the contentJson/contentMarkdown format
 * required by MessageRepository.insert. Use this in tests to avoid verbose JSON.
 *
 * @example
 * await MessageRepository.insert(client, {
 *   id: msgId,
 *   streamId,
 *   sequence: BigInt(1),
 *   authorId,
 *   authorType: "user",
 *   ...testMessageContent("Hello world"),
 * })
 */
export function testMessageContent(content: string) {
  return {
    contentJson: testContentJson(content),
    contentMarkdown: content,
  }
}
