/**
 * Database isolation for AI evaluations.
 *
 * Each eval run gets a fresh database to ensure isolation.
 * Supports --use-test-db flag for faster iteration.
 */

import { Pool } from "pg"
import { Umzug } from "umzug"
import path from "path"
import { createDatabasePool } from "../../src/db"
import type { DatabaseOptions } from "./types"

const ADMIN_DATABASE_URL = "postgresql://threa:threa@localhost:5454/postgres"
const TEST_DATABASE_URL = "postgresql://threa:threa@localhost:5454/threa_test"
const DATABASE_HOST = "postgresql://threa:threa@localhost:5454"

/**
 * Create a quiet migrator (no logging) for eval runs.
 */
function createQuietMigrator(pool: Pool) {
  return new Umzug({
    migrations: {
      glob: path.join(import.meta.dirname, "../../src/db/migrations/*.sql"),
      resolve: ({ name, path: filepath }) => ({
        name,
        up: async () => {
          const sql = await Bun.file(filepath!).text()
          await pool.query(sql)
        },
        down: async () => {
          throw new Error("Down migrations not supported")
        },
      }),
    },
    storage: {
      async executed() {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS umzug_migrations (
            name VARCHAR(255) PRIMARY KEY,
            executed_at TIMESTAMPTZ DEFAULT NOW()
          )
        `)
        const result = await pool.query("SELECT name FROM umzug_migrations ORDER BY name")
        return result.rows.map((r) => r.name)
      },
      async logMigration({ name }) {
        await pool.query("INSERT INTO umzug_migrations (name) VALUES ($1)", [name])
      },
      async unlogMigration({ name }) {
        await pool.query("DELETE FROM umzug_migrations WHERE name = $1", [name])
      },
    },
    // No logger = quiet migrations
    logger: undefined,
  })
}

/**
 * Generate a unique database name for an eval run.
 */
function generateEvalDatabaseName(label?: string): string {
  const timestamp = Date.now()
  const suffix = label ? `_${label.replace(/[^a-z0-9]/gi, "_").toLowerCase()}` : ""
  return `threa_eval_${timestamp}${suffix}`
}

/**
 * Create a fresh database for eval isolation.
 */
async function createEvalDatabase(name: string): Promise<void> {
  const adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL })

  try {
    // Check if database already exists
    const result = await adminPool.query("SELECT 1 FROM pg_database WHERE datname = $1", [name])

    if (result.rows.length === 0) {
      // Use template0 for clean database
      await adminPool.query(`CREATE DATABASE "${name}" TEMPLATE template0`)
    }
  } finally {
    await adminPool.end()
  }
}

/**
 * Drop an eval database after the run.
 */
async function dropEvalDatabase(name: string): Promise<void> {
  const adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL })

  try {
    // Terminate any remaining connections
    await adminPool.query(
      `
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = $1
        AND pid <> pg_backend_pid()
    `,
      [name]
    )

    // Drop the database
    await adminPool.query(`DROP DATABASE IF EXISTS "${name}"`)
  } finally {
    await adminPool.end()
  }
}

/**
 * Ensure the test database exists for --use-test-db mode.
 */
async function ensureTestDatabaseExists(): Promise<void> {
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
 * Result from setting up an eval database.
 */
export interface EvalDatabaseResult {
  /** Database pool connected to the eval database */
  pool: Pool
  /** Database name (for cleanup) */
  databaseName: string
  /** Cleanup function to drop the database */
  cleanup: () => Promise<void>
}

/**
 * Set up an isolated database for eval runs.
 *
 * When useTestDb is true, reuses the existing test database (faster but no isolation).
 * Otherwise creates a fresh database with unique name.
 */
export async function setupEvalDatabase(options: DatabaseOptions = {}): Promise<EvalDatabaseResult> {
  if (options.useTestDb) {
    // Fast path: reuse test database
    await ensureTestDatabaseExists()
    const pool = createDatabasePool(process.env.TEST_DATABASE_URL ?? TEST_DATABASE_URL)
    const migrator = createQuietMigrator(pool)
    await migrator.up()

    return {
      pool,
      databaseName: "threa_test",
      cleanup: async () => {
        await pool.end()
      },
    }
  }

  // Isolated path: create fresh database
  const databaseName = generateEvalDatabaseName(options.label)
  await createEvalDatabase(databaseName)

  const connectionString = `${DATABASE_HOST}/${databaseName}`
  const pool = createDatabasePool(connectionString)

  // Run migrations (quietly)
  const migrator = createQuietMigrator(pool)
  await migrator.up()

  return {
    pool,
    databaseName,
    cleanup: async () => {
      await pool.end()
      await dropEvalDatabase(databaseName)
    },
  }
}

/**
 * Truncate all tables in the database.
 * Useful for resetting state between test cases when using --use-test-db.
 */
export async function truncateAllTables(pool: Pool): Promise<void> {
  const result = await pool.query<{ tablename: string }>(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename != 'umzug_migrations'
  `)

  if (result.rows.length === 0) return

  const tables = result.rows.map((r) => `"${r.tablename}"`).join(", ")
  await pool.query(`TRUNCATE ${tables} CASCADE`)
}
