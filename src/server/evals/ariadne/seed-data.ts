/**
 * Seed data for Ariadne agent evals.
 *
 * Creates a realistic test environment with users, channels, messages, and memos.
 * The content is designed to be distinctive enough for full-text search matching.
 *
 * Reuses the existing e2e test infrastructure:
 * - getTestPool() for database connection
 * - Factory functions from test-helpers.ts
 */

import { Pool } from "pg"
import { sql } from "../../lib/db"
import {
  getTestPool,
  cleanupTestData,
  createTestUser,
  createTestWorkspace,
  createTestStream,
  createTestMessage,
  createTestThread,
  createTestThinkingSpace,
  addUserToWorkspace,
  addUserToStream,
  TestUser,
  TestWorkspace,
  TestStream,
  TestEvent,
} from "../../services/__tests__/test-helpers"
import { memoId } from "../../lib/id"
import { generateEmbedding } from "../../lib/ai-providers"
import { getMemoEmbeddingTable, getTextMessageEmbeddingTable } from "../../lib/embedding-tables"
import { logger } from "../../lib/logger"
import { runMigrations } from "../../lib/migrations"

export interface SeededData {
  workspace: TestWorkspace
  users: {
    kris: TestUser
    stefan: TestUser
    annica: TestUser
    ariadne: TestUser
  }
  channels: {
    general: TestStream
    engineering: TestStream
    product: TestStream
    backend: TestStream
    devops: TestStream
  }
  threads: Map<string, TestStream>
  thinkingSpaces: {
    krisThinking: TestStream
  }
  messages: Map<string, TestEvent>
  memos: Map<string, string> // memoId -> summary
}

/**
 * Seed the test database with eval data.
 * Returns the created entities for verification in tests.
 */
export async function seedAriadneEvalData(pool: Pool): Promise<SeededData> {
  logger.info("Seeding Ariadne eval data...")

  // Create workspace
  const workspace = await createTestWorkspace(pool, {
    id: "ws_eval_ariadne",
    name: "Ariadne Eval Workspace",
    slug: "ariadne-eval",
  })

  // Create users
  const kris = await createTestUser(pool, {
    id: "usr_eval_kris",
    name: "Kris",
    email: "kris@eval.test",
  })
  const stefan = await createTestUser(pool, {
    id: "usr_eval_stefan",
    name: "Stefan",
    email: "stefan@eval.test",
  })
  const annica = await createTestUser(pool, {
    id: "usr_eval_annica",
    name: "Annica",
    email: "annica@eval.test",
  })
  const ariadne = await createTestUser(pool, {
    id: "usr_eval_ariadne",
    name: "Ariadne",
    email: "ariadne@eval.test",
  })

  // Add users to workspace
  await addUserToWorkspace(pool, kris.id, workspace.id, "owner")
  await addUserToWorkspace(pool, stefan.id, workspace.id, "admin")
  await addUserToWorkspace(pool, annica.id, workspace.id, "member")
  await addUserToWorkspace(pool, ariadne.id, workspace.id, "member")

  // Create channels
  const general = await createTestStream(pool, workspace.id, {
    id: "str_eval_general",
    name: "general",
    slug: "general",
    visibility: "public",
  })
  const engineering = await createTestStream(pool, workspace.id, {
    id: "str_eval_engineering",
    name: "engineering",
    slug: "engineering",
    visibility: "public",
  })
  const product = await createTestStream(pool, workspace.id, {
    id: "str_eval_product",
    name: "product",
    slug: "product",
    visibility: "public",
  })
  const backend = await createTestStream(pool, workspace.id, {
    id: "str_eval_backend",
    name: "backend",
    slug: "backend",
    visibility: "public",
  })
  const devops = await createTestStream(pool, workspace.id, {
    id: "str_eval_devops",
    name: "devops",
    slug: "devops",
    visibility: "public",
  })

  const threads = new Map<string, TestStream>()
  const messages = new Map<string, TestEvent>()

  // ==========================================================================
  // Scenario 1: API Versioning Decision (retrieval_simple)
  // ==========================================================================
  const apiVersioningMsg1 = await createTestMessage(
    pool,
    engineering.id,
    kris.id,
    "We need to decide on an API versioning strategy for our REST endpoints. I'm thinking URL-based versioning like /api/v1/users would be cleaner than header-based versioning.",
    { id: "evt_eval_api_v1" },
  )
  messages.set("api_versioning_1", apiVersioningMsg1)

  const apiVersioningMsg2 = await createTestMessage(
    pool,
    engineering.id,
    stefan.id,
    "Agreed on URL-based versioning. It's more discoverable and easier to test. We should use v1, v2 etc for major breaking changes only.",
    { id: "evt_eval_api_v2" },
  )
  messages.set("api_versioning_2", apiVersioningMsg2)

  // ==========================================================================
  // Scenario 2: Authentication Discussion (retrieval_simple)
  // ==========================================================================
  const authMsg1 = await createTestMessage(
    pool,
    engineering.id,
    kris.id,
    "For authentication we're using WorkOS AuthKit which handles SSO, MFA, and session management. JWT tokens are validated on each request in middleware.",
    { id: "evt_eval_auth_1" },
  )
  messages.set("auth_1", authMsg1)

  // ==========================================================================
  // Scenario 3: Deployment Pipeline (retrieval_filtered - fromUsers:Kris)
  // ==========================================================================
  const deploymentMsg1 = await createTestMessage(
    pool,
    devops.id,
    kris.id,
    "Our deployment pipeline uses GitHub Actions with three stages: build, test, and deploy. We have staging and production environments, with automatic deployments to staging on merge to main.",
    { id: "evt_eval_deploy_1" },
  )
  messages.set("deployment_1", deploymentMsg1)

  const deploymentMsg2 = await createTestMessage(
    pool,
    devops.id,
    stefan.id,
    "The CI/CD setup looks good. Should we add canary deployments for production?",
    { id: "evt_eval_deploy_2" },
  )
  messages.set("deployment_2", deploymentMsg2)

  // ==========================================================================
  // Scenario 4: Q1 Roadmap (retrieval_filtered - inChannels:product)
  // ==========================================================================
  const roadmapMsg1 = await createTestMessage(
    pool,
    product.id,
    annica.id,
    "Q1 roadmap priorities: 1) Improve authentication flow with WorkOS 2) Mobile app MVP 3) Analytics dashboard. The mobile app is the biggest investment.",
    { id: "evt_eval_roadmap_1" },
  )
  messages.set("roadmap_1", roadmapMsg1)

  // ==========================================================================
  // Scenario 5: Database Migration Thread (context_gathering)
  // ==========================================================================
  const migrationRootMsg = await createTestMessage(
    pool,
    backend.id,
    stefan.id,
    "Database migration discussion: We need to add a user_settings table to store per-user preferences. What's the best approach?",
    { id: "evt_eval_migration_root" },
  )
  messages.set("migration_root", migrationRootMsg)

  const migrationThread = await createTestThread(pool, workspace.id, backend.id, migrationRootMsg.id, {
    id: "str_eval_migration_thread",
  })
  threads.set("migration_thread", migrationThread)

  const migrationReply1 = await createTestMessage(
    pool,
    migrationThread.id,
    kris.id,
    "Use the existing migration pattern in src/server/lib/migrations. Create a new file like 0042_user_settings.sql with the CREATE TABLE statement.",
    { id: "evt_eval_migration_reply1" },
  )
  messages.set("migration_reply_1", migrationReply1)

  const migrationReply2 = await createTestMessage(
    pool,
    migrationThread.id,
    stefan.id,
    "Got it. I'll add indexes on user_id and make sure we have proper foreign key constraints.",
    { id: "evt_eval_migration_reply2" },
  )
  messages.set("migration_reply_2", migrationReply2)

  // ==========================================================================
  // Scenario 6: Caching Discussion (multi_tool)
  // ==========================================================================
  const cachingMsg1 = await createTestMessage(
    pool,
    backend.id,
    kris.id,
    "We decided to use Redis for caching with a 5-minute TTL as the default. Cache invalidation happens on write operations. The caching layer is working well in production.",
    { id: "evt_eval_caching_1" },
  )
  messages.set("caching_1", cachingMsg1)

  // ==========================================================================
  // Scenario 7: Recent Channel Discussion (get_stream_context)
  // ==========================================================================
  const recentMsg1 = await createTestMessage(pool, general.id, kris.id, "Good morning everyone!", {
    id: "evt_eval_recent_1",
    createdAt: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago
  })
  messages.set("recent_1", recentMsg1)

  const recentMsg2 = await createTestMessage(pool, general.id, stefan.id, "Hey! Ready for the sprint planning meeting?", {
    id: "evt_eval_recent_2",
    createdAt: new Date(Date.now() - 25 * 60 * 1000), // 25 min ago
  })
  messages.set("recent_2", recentMsg2)

  const recentMsg3 = await createTestMessage(pool, general.id, kris.id, "Yes, let's do it. Starting in 5 minutes.", {
    id: "evt_eval_recent_3",
    createdAt: new Date(Date.now() - 20 * 60 * 1000), // 20 min ago
  })
  messages.set("recent_3", recentMsg3)

  // ==========================================================================
  // Thinking Space (for user scope testing)
  // ==========================================================================
  const krisThinking = await createTestThinkingSpace(pool, workspace.id, kris.id, {
    id: "str_eval_kris_thinking",
    name: "Kris's Thinking Space",
  })

  // ==========================================================================
  // Create Memos
  // ==========================================================================
  const memos = new Map<string, string>()

  // Memo for API versioning
  const apiMemoId = memoId()
  await createMemo(pool, {
    id: apiMemoId,
    workspaceId: workspace.id,
    summary:
      "We decided to use URL-based versioning (v1, v2) for the REST API. Major breaking changes warrant new version numbers. Header-based versioning was rejected as being less discoverable.",
    topics: ["API", "versioning", "REST", "architecture"],
    anchorEventIds: [apiVersioningMsg1.id, apiVersioningMsg2.id],
    contextStreamId: engineering.id,
    confidence: 0.9,
  })
  memos.set(apiMemoId, "API versioning decision")

  // Memo for authentication
  const authMemoId = memoId()
  await createMemo(pool, {
    id: authMemoId,
    workspaceId: workspace.id,
    summary:
      "Authentication uses WorkOS AuthKit for SSO, MFA, and session management. JWT tokens are validated on each request via middleware.",
    topics: ["authentication", "auth", "WorkOS", "SSO", "JWT", "security"],
    anchorEventIds: [authMsg1.id],
    contextStreamId: engineering.id,
    confidence: 0.85,
  })
  memos.set(authMemoId, "Authentication setup")

  // Memo for caching
  const cachingMemoId = memoId()
  await createMemo(pool, {
    id: cachingMemoId,
    workspaceId: workspace.id,
    summary:
      "Redis caching with 5-minute TTL. Cache invalidation on write operations. Production-tested and working well.",
    topics: ["caching", "Redis", "performance", "TTL"],
    anchorEventIds: [cachingMsg1.id],
    contextStreamId: backend.id,
    confidence: 0.88,
  })
  memos.set(cachingMemoId, "Caching strategy")

  // Try to generate embeddings (optional - works without)
  await generateEmbeddingsForEvalData(pool, messages, memos)

  logger.info(
    {
      workspace: workspace.id,
      users: 4,
      channels: 5,
      threads: threads.size,
      messages: messages.size,
      memos: memos.size,
    },
    "Ariadne eval data seeded successfully",
  )

  return {
    workspace,
    users: { kris, stefan, annica, ariadne },
    channels: { general, engineering, product, backend, devops },
    threads,
    thinkingSpaces: { krisThinking },
    messages,
    memos,
  }
}

/**
 * Create a memo directly in the database (bypasses MemoService for simpler seeding).
 */
async function createMemo(
  pool: Pool,
  params: {
    id: string
    workspaceId: string
    summary: string
    topics: string[]
    anchorEventIds: string[]
    contextStreamId: string
    confidence: number
  },
): Promise<void> {
  await pool.query(
    sql`INSERT INTO memos (
      id, workspace_id, summary, topics,
      anchor_event_ids, context_stream_id,
      confidence, source, visibility, search_vector
    ) VALUES (
      ${params.id}, ${params.workspaceId}, ${params.summary}, ${params.topics},
      ${params.anchorEventIds}, ${params.contextStreamId},
      ${params.confidence}, 'ariadne', 'workspace',
      to_tsvector('english', ${params.summary} || ' ' || ${params.topics.join(" ")})
    )`,
  )
}

/**
 * Generate embeddings for seeded data (optional, falls back to full-text search).
 */
async function generateEmbeddingsForEvalData(
  pool: Pool,
  messages: Map<string, TestEvent>,
  memos: Map<string, string>,
): Promise<void> {
  try {
    const textMessageTable = getTextMessageEmbeddingTable()
    const memoEmbeddingTable = getMemoEmbeddingTable()

    // Generate embeddings for messages
    for (const [_key, event] of messages) {
      try {
        const result = await generateEmbedding(event.content)
        // Get the text_message_id from the event
        const tmResult = await pool.query(
          sql`SELECT content_id FROM stream_events WHERE id = ${event.id}`,
        )
        if (tmResult.rows[0]) {
          await pool.query(
            sql`INSERT INTO ${sql.raw(textMessageTable)} (text_message_id, embedding, model)
                VALUES (${tmResult.rows[0].content_id}, ${JSON.stringify(result.embedding)}::vector, ${result.model})
                ON CONFLICT (text_message_id) DO NOTHING`,
          )
        }
      } catch {
        // Skip if embedding fails - full-text search will work
      }
    }

    // Generate embeddings for memos
    for (const [memoId, summary] of memos) {
      try {
        const result = await generateEmbedding(summary)
        await pool.query(
          sql`INSERT INTO ${sql.raw(memoEmbeddingTable)} (memo_id, embedding, model)
              VALUES (${memoId}, ${JSON.stringify(result.embedding)}::vector, ${result.model})
              ON CONFLICT (memo_id) DO NOTHING`,
        )
      } catch {
        // Skip if embedding fails - full-text search will work
      }
    }

    logger.debug("Generated embeddings for eval data")
  } catch (err) {
    logger.warn({ err }, "Could not generate embeddings - using full-text search only")
  }
}

/**
 * Clean up eval data from the database.
 */
export async function cleanupAriadneEvalData(pool: Pool): Promise<void> {
  // Helper to safely delete from a table that may not exist
  const safeDelete = async (query: string) => {
    try {
      await pool.query(query)
    } catch (err) {
      // Ignore "relation does not exist" errors (42P01)
      if ((err as { code?: string }).code !== "42P01") {
        throw err
      }
    }
  }

  // Delete embeddings first (tables may not exist in test DB)
  await safeDelete(`DELETE FROM memo_embeddings WHERE memo_id IN (SELECT id FROM memos WHERE workspace_id = 'ws_eval_ariadne')`)
  await safeDelete(`DELETE FROM memo_embeddings_ollama WHERE memo_id IN (SELECT id FROM memos WHERE workspace_id = 'ws_eval_ariadne')`)
  await safeDelete(`DELETE FROM text_message_embeddings WHERE text_message_id IN (SELECT content_id FROM stream_events WHERE id LIKE 'evt_eval_%')`)
  await safeDelete(`DELETE FROM text_message_embeddings_ollama WHERE text_message_id IN (SELECT content_id FROM stream_events WHERE id LIKE 'evt_eval_%')`)

  // Delete in order respecting foreign keys
  await pool.query(sql`DELETE FROM memos WHERE workspace_id = 'ws_eval_ariadne'`)
  await pool.query(sql`DELETE FROM stream_members WHERE stream_id LIKE 'str_eval_%'`)
  await pool.query(sql`DELETE FROM stream_events WHERE id LIKE 'evt_eval_%'`)
  await pool.query(sql`DELETE FROM text_messages WHERE id IN (SELECT content_id FROM stream_events WHERE id LIKE 'evt_eval_%')`)
  await pool.query(sql`DELETE FROM streams WHERE id LIKE 'str_eval_%'`)
  await pool.query(sql`DELETE FROM workspace_members WHERE workspace_id = 'ws_eval_ariadne'`)
  await pool.query(sql`DELETE FROM workspaces WHERE id = 'ws_eval_ariadne'`)
  await pool.query(sql`DELETE FROM users WHERE id LIKE 'usr_eval_%'`)

  logger.info("Ariadne eval data cleaned up")
}

/**
 * Initialize the eval environment.
 * Uses the shared test pool from e2e infrastructure.
 */
export async function initEvalEnvironment(): Promise<Pool> {
  const pool = await getTestPool()
  await runMigrations(pool)
  return pool
}

/**
 * Full setup: initialize pool, clean any stale data, seed fresh data.
 */
export async function setupAriadneEval(): Promise<{ pool: Pool; data: SeededData }> {
  const pool = await initEvalEnvironment()
  await cleanupAriadneEvalData(pool)
  const data = await seedAriadneEvalData(pool)
  return { pool, data }
}
