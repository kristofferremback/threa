import { PoolClient } from "pg"
import { sql } from "../db"

// Internal row type (snake_case, not exported)
interface UserRow {
  id: string
  email: string
  name: string
  workos_user_id: string | null
  timezone: string | null
  locale: string | null
  created_at: Date
  updated_at: Date
}

// Domain type (camelCase, exported)
export interface User {
  id: string
  email: string
  name: string
  workosUserId: string | null
  timezone: string | null
  locale: string | null
  createdAt: Date
  updatedAt: Date
}

export interface InsertUserParams {
  id: string
  email: string
  name: string
  workosUserId?: string
}

function mapRowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    workosUserId: row.workos_user_id,
    timezone: row.timezone,
    locale: row.locale,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const UserRepository = {
  async findById(client: PoolClient, id: string): Promise<User | null> {
    const result = await client.query<UserRow>(sql`
      SELECT id, email, name, workos_user_id, timezone, locale, created_at, updated_at
      FROM users WHERE id = ${id}
    `)
    return result.rows[0] ? mapRowToUser(result.rows[0]) : null
  },

  async findByEmail(client: PoolClient, email: string): Promise<User | null> {
    const result = await client.query<UserRow>(sql`
      SELECT id, email, name, workos_user_id, timezone, locale, created_at, updated_at
      FROM users WHERE email = ${email}
    `)
    return result.rows[0] ? mapRowToUser(result.rows[0]) : null
  },

  async findByWorkosUserId(
    client: PoolClient,
    workosUserId: string,
  ): Promise<User | null> {
    const result = await client.query<UserRow>(sql`
      SELECT id, email, name, workos_user_id, timezone, locale, created_at, updated_at
      FROM users WHERE workos_user_id = ${workosUserId}
    `)
    return result.rows[0] ? mapRowToUser(result.rows[0]) : null
  },

  async insert(client: PoolClient, params: InsertUserParams): Promise<User> {
    const result = await client.query<UserRow>(sql`
      INSERT INTO users (id, email, name, workos_user_id)
      VALUES (${params.id}, ${params.email}, ${params.name}, ${params.workosUserId ?? null})
      RETURNING id, email, name, workos_user_id, timezone, locale, created_at, updated_at
    `)
    return mapRowToUser(result.rows[0])
  },

  async upsertByEmail(
    client: PoolClient,
    params: InsertUserParams,
  ): Promise<User> {
    const result = await client.query<UserRow>(sql`
      INSERT INTO users (id, email, name, workos_user_id)
      VALUES (${params.id}, ${params.email}, ${params.name}, ${params.workosUserId ?? null})
      ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name,
        workos_user_id = COALESCE(EXCLUDED.workos_user_id, users.workos_user_id),
        updated_at = NOW()
      RETURNING id, email, name, workos_user_id, timezone, locale, created_at, updated_at
    `)
    return mapRowToUser(result.rows[0])
  },
}
