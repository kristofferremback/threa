import { PoolClient } from "pg"
import { sql } from "../db"

// Internal row type (snake_case, not exported)
interface UserRow {
  id: string
  email: string
  name: string
  slug: string
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
  slug: string
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
    slug: row.slug,
    workosUserId: row.workos_user_id,
    timezone: row.timezone,
    locale: row.locale,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Generate a URL-friendly slug from a name.
 * - Lowercase
 * - Replace spaces with hyphens
 * - Remove special characters
 * - Max 32 chars
 */
function generateBaseSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32)
}

/**
 * Generate a unique slug, appending a number suffix if needed.
 */
async function generateUniqueSlug(client: PoolClient, name: string): Promise<string> {
  const baseSlug = generateBaseSlug(name)
  if (!baseSlug) {
    return `user-${Date.now()}`
  }

  // Check if base slug is available
  const existing = await client.query<{ slug: string }>(sql`
    SELECT slug FROM users WHERE slug LIKE ${baseSlug + "%"}
  `)

  if (existing.rows.length === 0) {
    return baseSlug
  }

  // Find existing slugs that match our pattern
  const existingSlugs = new Set(existing.rows.map((r) => r.slug))

  if (!existingSlugs.has(baseSlug)) {
    return baseSlug
  }

  // Find next available number
  let suffix = 2
  while (existingSlugs.has(`${baseSlug}-${suffix}`)) {
    suffix++
  }

  return `${baseSlug}-${suffix}`
}

export const UserRepository = {
  async findById(client: PoolClient, id: string): Promise<User | null> {
    const result = await client.query<UserRow>(sql`
      SELECT id, email, name, slug, workos_user_id, timezone, locale, created_at, updated_at
      FROM users WHERE id = ${id}
    `)
    return result.rows[0] ? mapRowToUser(result.rows[0]) : null
  },

  async findByEmail(client: PoolClient, email: string): Promise<User | null> {
    const result = await client.query<UserRow>(sql`
      SELECT id, email, name, slug, workos_user_id, timezone, locale, created_at, updated_at
      FROM users WHERE email = ${email}
    `)
    return result.rows[0] ? mapRowToUser(result.rows[0]) : null
  },

  async findBySlug(client: PoolClient, slug: string): Promise<User | null> {
    const result = await client.query<UserRow>(sql`
      SELECT id, email, name, slug, workos_user_id, timezone, locale, created_at, updated_at
      FROM users WHERE slug = ${slug}
    `)
    return result.rows[0] ? mapRowToUser(result.rows[0]) : null
  },

  async findByWorkosUserId(client: PoolClient, workosUserId: string): Promise<User | null> {
    const result = await client.query<UserRow>(sql`
      SELECT id, email, name, slug, workos_user_id, timezone, locale, created_at, updated_at
      FROM users WHERE workos_user_id = ${workosUserId}
    `)
    return result.rows[0] ? mapRowToUser(result.rows[0]) : null
  },

  async findByIds(client: PoolClient, ids: string[]): Promise<User[]> {
    if (ids.length === 0) return []

    const result = await client.query<UserRow>(sql`
      SELECT id, email, name, slug, workos_user_id, timezone, locale, created_at, updated_at
      FROM users WHERE id = ANY(${ids})
    `)
    return result.rows.map(mapRowToUser)
  },

  async insert(client: PoolClient, params: InsertUserParams): Promise<User> {
    const slug = await generateUniqueSlug(client, params.name)
    const result = await client.query<UserRow>(sql`
      INSERT INTO users (id, email, name, slug, workos_user_id)
      VALUES (${params.id}, ${params.email}, ${params.name}, ${slug}, ${params.workosUserId ?? null})
      RETURNING id, email, name, slug, workos_user_id, timezone, locale, created_at, updated_at
    `)
    return mapRowToUser(result.rows[0])
  },

  async upsertByEmail(client: PoolClient, params: InsertUserParams): Promise<User> {
    // Check if user exists to determine if we need a new slug
    const existing = await client.query<{ id: string }>(sql`
      SELECT id FROM users WHERE email = ${params.email}
    `)

    if (existing.rows.length > 0) {
      // User exists, just update (slug stays the same)
      const result = await client.query<UserRow>(sql`
        UPDATE users SET
          name = ${params.name},
          workos_user_id = COALESCE(${params.workosUserId ?? null}, workos_user_id),
          updated_at = NOW()
        WHERE email = ${params.email}
        RETURNING id, email, name, slug, workos_user_id, timezone, locale, created_at, updated_at
      `)
      return mapRowToUser(result.rows[0])
    }

    // New user, generate slug
    const slug = await generateUniqueSlug(client, params.name)
    const result = await client.query<UserRow>(sql`
      INSERT INTO users (id, email, name, slug, workos_user_id)
      VALUES (${params.id}, ${params.email}, ${params.name}, ${slug}, ${params.workosUserId ?? null})
      RETURNING id, email, name, slug, workos_user_id, timezone, locale, created_at, updated_at
    `)
    return mapRowToUser(result.rows[0])
  },
}
