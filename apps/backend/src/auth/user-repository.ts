import type { Querier } from "../db"
import { sql } from "../db"

interface UserRow {
  id: string
  email: string
  name: string
  workos_user_id: string | null
  created_at: Date
  updated_at: Date
}

export interface User {
  id: string
  email: string
  name: string
  workosUserId: string | null
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const UserRepository = {
  async findById(db: Querier, id: string): Promise<User | null> {
    const result = await db.query<UserRow>(sql`
      SELECT id, email, name, workos_user_id, created_at, updated_at
      FROM users WHERE id = ${id}
    `)
    return result.rows[0] ? mapRowToUser(result.rows[0]) : null
  },

  async findByEmail(db: Querier, email: string): Promise<User | null> {
    const result = await db.query<UserRow>(sql`
      SELECT id, email, name, workos_user_id, created_at, updated_at
      FROM users WHERE email = ${email}
    `)
    return result.rows[0] ? mapRowToUser(result.rows[0]) : null
  },

  async findByWorkosUserId(db: Querier, workosUserId: string): Promise<User | null> {
    const result = await db.query<UserRow>(sql`
      SELECT id, email, name, workos_user_id, created_at, updated_at
      FROM users WHERE workos_user_id = ${workosUserId}
    `)
    return result.rows[0] ? mapRowToUser(result.rows[0]) : null
  },

  async findByIds(db: Querier, ids: string[]): Promise<User[]> {
    if (ids.length === 0) return []

    const result = await db.query<UserRow>(sql`
      SELECT id, email, name, workos_user_id, created_at, updated_at
      FROM users WHERE id = ANY(${ids})
    `)
    return result.rows.map(mapRowToUser)
  },

  async findByEmails(db: Querier, emails: string[]): Promise<User[]> {
    if (emails.length === 0) return []

    const result = await db.query<UserRow>(sql`
      SELECT id, email, name, workos_user_id, created_at, updated_at
      FROM users WHERE email = ANY(${emails})
    `)
    return result.rows.map(mapRowToUser)
  },

  async insert(db: Querier, params: InsertUserParams): Promise<User> {
    const result = await db.query<UserRow>(sql`
      INSERT INTO users (id, email, name, workos_user_id)
      VALUES (${params.id}, ${params.email}, ${params.name}, ${params.workosUserId ?? null})
      RETURNING id, email, name, workos_user_id, created_at, updated_at
    `)
    return mapRowToUser(result.rows[0])
  },

  async upsertByEmail(db: Querier, params: InsertUserParams): Promise<User> {
    const result = await db.query<UserRow>(sql`
      INSERT INTO users (id, email, name, workos_user_id)
      VALUES (${params.id}, ${params.email}, ${params.name}, ${params.workosUserId ?? null})
      ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name,
        workos_user_id = COALESCE(EXCLUDED.workos_user_id, users.workos_user_id),
        updated_at = NOW()
      RETURNING id, email, name, workos_user_id, created_at, updated_at
    `)
    return mapRowToUser(result.rows[0])
  },
}
