import type { Querier } from "../db"
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
 * Generate a candidate slug, appending a number suffix if needed based on existing slugs.
 * This is best-effort - the insert may still fail due to race conditions, which is handled by retry logic.
 */
async function generateCandidateSlug(db: Querier, name: string): Promise<string> {
  const baseSlug = generateBaseSlug(name)
  if (!baseSlug) {
    return `user-${Date.now()}`
  }

  // Check existing slugs with this prefix
  const existing = await db.query<{ slug: string }>(sql`
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

/**
 * Insert a user with a unique slug, retrying with incremented suffix on conflict.
 * Handles race conditions where concurrent inserts claim the same slug.
 */
async function insertUserWithUniqueSlug(
  db: Querier,
  params: InsertUserParams,
  candidateSlug: string,
  maxRetries = 3
): Promise<User> {
  let slug = candidateSlug
  let attempts = 0

  while (attempts < maxRetries) {
    try {
      const result = await db.query<UserRow>(sql`
        INSERT INTO users (id, email, name, slug, workos_user_id)
        VALUES (${params.id}, ${params.email}, ${params.name}, ${slug}, ${params.workosUserId ?? null})
        RETURNING id, email, name, slug, workos_user_id, timezone, locale, created_at, updated_at
      `)
      return mapRowToUser(result.rows[0])
    } catch (error) {
      // Check if it's a unique constraint violation on slug
      if (error instanceof Error && "code" in error && (error as { code: string }).code === "23505") {
        attempts++
        // Append or increment suffix
        const baseSlug = generateBaseSlug(params.name) || "user"
        slug = `${baseSlug}-${Date.now()}-${attempts}`
      } else {
        throw error
      }
    }
  }

  // Final attempt with guaranteed unique suffix
  const result = await db.query<UserRow>(sql`
    INSERT INTO users (id, email, name, slug, workos_user_id)
    VALUES (${params.id}, ${params.email}, ${params.name}, ${`user-${params.id}`}, ${params.workosUserId ?? null})
    RETURNING id, email, name, slug, workos_user_id, timezone, locale, created_at, updated_at
  `)
  return mapRowToUser(result.rows[0])
}

export const UserRepository = {
  async findById(db: Querier, id: string): Promise<User | null> {
    const result = await db.query<UserRow>(sql`
      SELECT id, email, name, slug, workos_user_id, timezone, locale, created_at, updated_at
      FROM users WHERE id = ${id}
    `)
    return result.rows[0] ? mapRowToUser(result.rows[0]) : null
  },

  async findByEmail(db: Querier, email: string): Promise<User | null> {
    const result = await db.query<UserRow>(sql`
      SELECT id, email, name, slug, workos_user_id, timezone, locale, created_at, updated_at
      FROM users WHERE email = ${email}
    `)
    return result.rows[0] ? mapRowToUser(result.rows[0]) : null
  },

  async findBySlug(db: Querier, slug: string): Promise<User | null> {
    const result = await db.query<UserRow>(sql`
      SELECT id, email, name, slug, workos_user_id, timezone, locale, created_at, updated_at
      FROM users WHERE slug = ${slug}
    `)
    return result.rows[0] ? mapRowToUser(result.rows[0]) : null
  },

  async findByWorkosUserId(db: Querier, workosUserId: string): Promise<User | null> {
    const result = await db.query<UserRow>(sql`
      SELECT id, email, name, slug, workos_user_id, timezone, locale, created_at, updated_at
      FROM users WHERE workos_user_id = ${workosUserId}
    `)
    return result.rows[0] ? mapRowToUser(result.rows[0]) : null
  },

  async findByIds(db: Querier, ids: string[]): Promise<User[]> {
    if (ids.length === 0) return []

    const result = await db.query<UserRow>(sql`
      SELECT id, email, name, slug, workos_user_id, timezone, locale, created_at, updated_at
      FROM users WHERE id = ANY(${ids})
    `)
    return result.rows.map(mapRowToUser)
  },

  async insert(db: Querier, params: InsertUserParams): Promise<User> {
    const candidateSlug = await generateCandidateSlug(db, params.name)
    return insertUserWithUniqueSlug(db, params, candidateSlug)
  },

  async upsertByEmail(db: Querier, params: InsertUserParams): Promise<User> {
    // Generate candidate slug for potential new user
    // The slug is only used on INSERT, not on UPDATE (existing users keep their slug)
    const candidateSlug = await generateCandidateSlug(db, params.name)

    // Atomic upsert - no race condition between concurrent requests
    // ON CONFLICT updates existing users; INSERT uses the candidate slug for new users
    const result = await db.query<UserRow>(sql`
      INSERT INTO users (id, email, name, slug, workos_user_id)
      VALUES (${params.id}, ${params.email}, ${params.name}, ${candidateSlug}, ${params.workosUserId ?? null})
      ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name,
        workos_user_id = COALESCE(EXCLUDED.workos_user_id, users.workos_user_id),
        updated_at = NOW()
      RETURNING id, email, name, slug, workos_user_id, timezone, locale, created_at, updated_at
    `)

    return mapRowToUser(result.rows[0])
  },
}
