import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "url"
import { dirname } from "path"
import { Pool } from "pg"
import { logger } from "./logger"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const migrationsDir = join(__dirname, "migrations")

export const runMigrations = async (pool: Pool) => {
  try {
    // Create migrations table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    // Get list of migration files
    const files = await readdir(migrationsDir)
    const migrationFiles = files
      .filter((f) => f.endsWith(".sql"))
      .sort() // Execute in order

    logger.info({ count: migrationFiles.length }, "Found migration files")

    // Get already applied migrations
    const appliedResult = await pool.query("SELECT id FROM migrations")
    const appliedIds = new Set(appliedResult.rows.map((r) => r.id))

    // Run each migration
    for (const file of migrationFiles) {
      const migrationId = file.replace(".sql", "")

      if (appliedIds.has(migrationId)) {
        logger.debug({ migration: migrationId }, "Migration already applied, skipping")
        continue
      }

      logger.info({ migration: migrationId }, "Running migration")

      const sql = await readFile(join(migrationsDir, file), "utf-8")

      // Run migration in transaction
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        await client.query(sql)
        await client.query("INSERT INTO migrations (id) VALUES ($1)", [migrationId])
        await client.query("COMMIT")
        logger.info({ migration: migrationId }, "Migration completed")
      } catch (err) {
        await client.query("ROLLBACK")
        throw err
      } finally {
        client.release()
      }
    }

    logger.info("All migrations completed")
  } catch (error) {
    logger.error({ err: error }, "Migration failed")
    throw error
  }
}

