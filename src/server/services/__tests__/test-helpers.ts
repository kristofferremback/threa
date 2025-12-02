import { Pool, PoolClient } from "pg"
import { sql } from "../../lib/db"
import { runMigrations } from "../../lib/migrations"

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || "postgresql://threa:threa@localhost:5434/threa_test"

let pool: Pool | null = null
let testClient: PoolClient | null = null

/**
 * Get or create a shared test database pool.
 * Runs migrations on first connection.
 */
export async function getTestPool(): Promise<Pool> {
  if (pool) return pool

  pool = new Pool({
    connectionString: TEST_DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  })

  // Verify connection
  const client = await pool.connect()
  await client.query("SELECT 1")
  client.release()

  // Run migrations
  await runMigrations(pool)

  return pool
}

/**
 * Close the test pool. Call in afterAll.
 */
export async function closeTestPool(): Promise<void> {
  if (testClient) {
    testClient.release()
    testClient = null
  }
  if (pool) {
    await pool.end()
    pool = null
  }
}

/**
 * Begin a transaction for test isolation.
 * All changes will be rolled back when endTestTransaction is called.
 * This is safer than deleting data - nothing persists between tests.
 */
export async function beginTestTransaction(p: Pool): Promise<PoolClient> {
  testClient = await p.connect()
  await testClient.query("BEGIN")
  // Use savepoint so nested transactions work
  await testClient.query("SAVEPOINT test_start")
  return testClient
}

/**
 * Rollback the test transaction. Call in afterEach.
 * This undoes all changes made during the test.
 */
export async function rollbackTestTransaction(): Promise<void> {
  if (testClient) {
    await testClient.query("ROLLBACK TO SAVEPOINT test_start")
    await testClient.query("ROLLBACK")
    testClient.release()
    testClient = null
  }
}

/**
 * Clean up all test data. Call in beforeEach or afterEach.
 * Note: Prefer using beginTestTransaction/rollbackTestTransaction instead
 * for better isolation and safety.
 */
export async function cleanupTestData(p: Pool): Promise<void> {
  // Delete in order respecting foreign keys
  await p.query("DELETE FROM notifications")
  await p.query("DELETE FROM message_revisions")
  await p.query("DELETE FROM outbox")
  await p.query("DELETE FROM stream_members")
  await p.query("DELETE FROM stream_events")
  await p.query("DELETE FROM shared_refs")
  await p.query("DELETE FROM text_messages")
  await p.query("DELETE FROM streams")
  await p.query("DELETE FROM workspace_members")
  await p.query("DELETE FROM workspace_profiles")
  await p.query("DELETE FROM workspaces")
  await p.query("DELETE FROM users")
}

// =============================================================================
// Factory Functions
// =============================================================================

export interface TestUser {
  id: string
  email: string
  name: string
}

export interface TestWorkspace {
  id: string
  name: string
  slug: string
}

export interface TestStream {
  id: string
  workspaceId: string
  streamType: "channel" | "thread" | "thinking_space"
  visibility: "public" | "private" | "inherit"
  name?: string
  slug?: string
  parentStreamId?: string
  branchedFromEventId?: string
}

export interface TestEvent {
  id: string
  streamId: string
  actorId: string
  content: string
  createdAt?: Date
}

let idCounter = 0
function generateId(prefix: string): string {
  return `${prefix}_test_${++idCounter}_${Date.now()}`
}

/**
 * Create a test user.
 */
export async function createTestUser(p: Pool, overrides: Partial<TestUser> = {}): Promise<TestUser> {
  const id = overrides.id || generateId("usr")
  const email = overrides.email || `${id}@test.com`
  const name = overrides.name || `Test User ${id}`

  await p.query(
    sql`INSERT INTO users (id, email, name, created_at, updated_at)
        VALUES (${id}, ${email}, ${name}, NOW(), NOW())`,
  )

  return { id, email, name }
}

/**
 * Create a test workspace.
 */
export async function createTestWorkspace(p: Pool, overrides: Partial<TestWorkspace> = {}): Promise<TestWorkspace> {
  const id = overrides.id || generateId("ws")
  const name = overrides.name || `Test Workspace ${id}`
  const slug = overrides.slug || id

  await p.query(
    sql`INSERT INTO workspaces (id, name, slug, created_at)
        VALUES (${id}, ${name}, ${slug}, NOW())`,
  )

  return { id, name, slug }
}

/**
 * Add a user to a workspace.
 */
export async function addUserToWorkspace(
  p: Pool,
  userId: string,
  workspaceId: string,
  role: "owner" | "admin" | "member" = "member",
): Promise<void> {
  await p.query(
    sql`INSERT INTO workspace_members (user_id, workspace_id, role, status, joined_at)
        VALUES (${userId}, ${workspaceId}, ${role}, 'active', NOW())
        ON CONFLICT (user_id, workspace_id) DO NOTHING`,
  )
}

/**
 * Create a test stream (channel, thread, or thinking space).
 */
export async function createTestStream(
  p: Pool,
  workspaceId: string,
  overrides: Partial<Omit<TestStream, "workspaceId">> = {},
): Promise<TestStream> {
  const id = overrides.id || generateId("str")
  const streamType = overrides.streamType || "channel"
  const visibility = overrides.visibility || "public"
  const name = overrides.name || (streamType === "channel" ? `Test Channel ${id}` : undefined)
  const slug = overrides.slug || (streamType === "channel" ? id : undefined)

  await p.query(
    sql`INSERT INTO streams (id, workspace_id, stream_type, visibility, name, slug, parent_stream_id, branched_from_event_id, created_at, updated_at)
        VALUES (${id}, ${workspaceId}, ${streamType}, ${visibility}, ${name}, ${slug}, ${overrides.parentStreamId || null}, ${overrides.branchedFromEventId || null}, NOW(), NOW())`,
  )

  return {
    id,
    workspaceId,
    streamType,
    visibility,
    name,
    slug,
    parentStreamId: overrides.parentStreamId,
    branchedFromEventId: overrides.branchedFromEventId,
  }
}

/**
 * Add a user to a stream as a member.
 */
export async function addUserToStream(
  p: Pool,
  userId: string,
  streamId: string,
  role: "owner" | "admin" | "member" = "member",
): Promise<void> {
  await p.query(
    sql`INSERT INTO stream_members (stream_id, user_id, role, joined_at, updated_at)
        VALUES (${streamId}, ${userId}, ${role}, NOW(), NOW())
        ON CONFLICT (stream_id, user_id) DO NOTHING`,
  )
}

/**
 * Create a test message event.
 */
export async function createTestMessage(
  p: Pool,
  streamId: string,
  actorId: string,
  content: string,
  overrides: { id?: string; createdAt?: Date; agentId?: string } = {},
): Promise<TestEvent> {
  const eventId = overrides.id || generateId("evt")
  const textMessageId = generateId("tm")
  const createdAt = overrides.createdAt || new Date()

  // Create text message
  await p.query(
    sql`INSERT INTO text_messages (id, content, created_at)
        VALUES (${textMessageId}, ${content}, ${createdAt})`,
  )

  // Create stream event
  if (overrides.agentId) {
    await p.query(
      sql`INSERT INTO stream_events (id, stream_id, event_type, actor_id, agent_id, content_type, content_id, created_at)
          VALUES (${eventId}, ${streamId}, 'message', ${actorId}, ${overrides.agentId}, 'text_message', ${textMessageId}, ${createdAt})`,
    )
  } else {
    await p.query(
      sql`INSERT INTO stream_events (id, stream_id, event_type, actor_id, content_type, content_id, created_at)
          VALUES (${eventId}, ${streamId}, 'message', ${actorId}, 'text_message', ${textMessageId}, ${createdAt})`,
    )
  }

  return { id: eventId, streamId, actorId, content, createdAt }
}

/**
 * Create a thread from an event.
 */
export async function createTestThread(
  p: Pool,
  workspaceId: string,
  parentStreamId: string,
  branchedFromEventId: string,
  overrides: Partial<Omit<TestStream, "workspaceId" | "streamType">> = {},
): Promise<TestStream> {
  return createTestStream(p, workspaceId, {
    ...overrides,
    streamType: "thread",
    visibility: overrides.visibility || "inherit",
    parentStreamId,
    branchedFromEventId,
  })
}

/**
 * Create a thinking space for a user.
 */
export async function createTestThinkingSpace(
  p: Pool,
  workspaceId: string,
  ownerId: string,
  overrides: Partial<Omit<TestStream, "workspaceId" | "streamType" | "visibility">> = {},
): Promise<TestStream> {
  const stream = await createTestStream(p, workspaceId, {
    ...overrides,
    streamType: "thinking_space",
    visibility: "private",
    name: overrides.name || "Thinking Space",
  })

  // Add owner as the only member
  await addUserToStream(p, ownerId, stream.id, "owner")

  return stream
}
