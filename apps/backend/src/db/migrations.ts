import { Umzug } from "umzug"
import { Pool } from "pg"
import path from "path"
import { logger } from "../lib/logger"

export function createMigrator(pool: Pool) {
  return new Umzug({
    migrations: {
      glob: path.join(import.meta.dirname, "migrations/*.sql"),
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
        const result = await pool.query(
          "SELECT name FROM umzug_migrations ORDER BY name",
        )
        return result.rows.map((r) => r.name)
      },
      async logMigration({ name }) {
        await pool.query("INSERT INTO umzug_migrations (name) VALUES ($1)", [
          name,
        ])
      },
      async unlogMigration({ name }) {
        await pool.query("DELETE FROM umzug_migrations WHERE name = $1", [name])
      },
    },
    logger,
  })
}
