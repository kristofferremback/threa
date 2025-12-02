/**
 * Test fixtures for memo evolution evaluation.
 *
 * These fixtures represent realistic workspace knowledge scenarios
 * for testing the deduplication and evolution logic.
 */

export interface MessageFixture {
  id: string
  content: string
  category: string
  expectedAction?: "create_new" | "reinforce" | "supersede" | "skip"
}

export interface MemoFixture {
  id: string
  summary: string
  anchorContent: string
  confidence: number
  source: "user" | "system" | "ariadne"
}

/**
 * Scenario: Identical messages (should skip or reinforce)
 *
 * Tests exact duplicates and near-duplicates that convey
 * the same information with slightly different wording.
 */
export const IDENTICAL_MESSAGES: { memo: MemoFixture; messages: MessageFixture[] } = {
  memo: {
    id: "memo_deploy_process",
    summary: "Deployment to production requires approval from the DevOps team and runs every Tuesday at 2pm.",
    anchorContent:
      "Hey team, just a reminder that all production deployments need DevOps approval first. We run them on Tuesdays at 2pm.",
    confidence: 0.8,
    source: "system",
  },
  messages: [
    {
      id: "msg_exact_dup",
      content:
        "Hey team, just a reminder that all production deployments need DevOps approval first. We run them on Tuesdays at 2pm.",
      category: "exact_duplicate",
      expectedAction: "skip",
    },
    {
      id: "msg_near_dup",
      content:
        "Quick reminder: production deploys need DevOps sign-off. Deployment window is Tuesday 2pm.",
      category: "near_duplicate",
      expectedAction: "reinforce",
    },
    {
      id: "msg_rephrased",
      content:
        "FYI - you need to get DevOps to approve your changes before they can go to prod. The deployment happens every Tuesday afternoon at 2.",
      category: "rephrased_same_info",
      expectedAction: "reinforce",
    },
  ],
}

/**
 * Scenario: Same topic, new information (should reinforce or supersede)
 *
 * Tests messages that discuss the same topic but add new details
 * or update existing information.
 */
export const SAME_TOPIC_NEW_INFO: { memo: MemoFixture; messages: MessageFixture[] } = {
  memo: {
    id: "memo_api_rate_limit",
    summary: "The external payment API has a rate limit of 100 requests per minute.",
    anchorContent: "Heads up - the Stripe API has a rate limit of 100 req/min so we need to be careful with batch operations.",
    confidence: 0.7,
    source: "system",
  },
  messages: [
    {
      id: "msg_additional_detail",
      content:
        "Also worth noting about the Stripe rate limits - they have a burst allowance of 25 requests that can exceed the 100/min limit briefly.",
      category: "additional_detail",
      expectedAction: "reinforce",
    },
    {
      id: "msg_correction",
      content:
        "Update on Stripe rate limits: they actually increased it to 200 requests per minute last month. The docs were outdated.",
      category: "correction_supersede",
      expectedAction: "supersede",
    },
    {
      id: "msg_clarification",
      content:
        "To clarify the Stripe rate limit discussion - the 100/min applies per API key, not per account. So we can use multiple keys if needed.",
      category: "clarification",
      expectedAction: "reinforce",
    },
  ],
}

/**
 * Scenario: Related but distinct topics (should create new)
 *
 * Tests messages that are in the same domain but discuss
 * different aspects that warrant separate memos.
 */
export const RELATED_DISTINCT: { memo: MemoFixture; messages: MessageFixture[] } = {
  memo: {
    id: "memo_auth_oauth",
    summary: "User authentication uses OAuth 2.0 with Google and GitHub as identity providers.",
    anchorContent:
      "Our auth system is built on OAuth 2.0. We support Google and GitHub as identity providers. Users can link multiple accounts.",
    confidence: 0.8,
    source: "system",
  },
  messages: [
    {
      id: "msg_auth_sessions",
      content:
        "Session management: we use JWT tokens with a 24h expiry. Refresh tokens last 30 days. Sessions are stored in Redis.",
      category: "related_different_aspect",
      expectedAction: "create_new",
    },
    {
      id: "msg_auth_permissions",
      content:
        "RBAC permissions: we have 4 roles - viewer, editor, admin, owner. Each inherits from the previous. Permissions are cached for 5 min.",
      category: "related_different_domain",
      expectedAction: "create_new",
    },
    {
      id: "msg_auth_2fa",
      content:
        "2FA implementation: we use TOTP (Google Authenticator compatible). Users can also use SMS as backup. Admin accounts require 2FA.",
      category: "related_different_feature",
      expectedAction: "create_new",
    },
  ],
}

/**
 * Scenario: Completely unrelated topics (should create new)
 *
 * Tests messages that have no semantic relationship to existing memos.
 */
export const UNRELATED_TOPICS: { memo: MemoFixture; messages: MessageFixture[] } = {
  memo: {
    id: "memo_database_backup",
    summary: "Database backups run daily at 3am UTC with 30-day retention. Point-in-time recovery is enabled.",
    anchorContent:
      "Database backup schedule: daily at 3am UTC, kept for 30 days. We also have PITR enabled for the last 7 days.",
    confidence: 0.85,
    source: "system",
  },
  messages: [
    {
      id: "msg_frontend_styling",
      content:
        "For the new dashboard, we're using Tailwind CSS with the default color palette. Custom components go in the ui/ folder.",
      category: "completely_unrelated",
      expectedAction: "create_new",
    },
    {
      id: "msg_meeting_notes",
      content:
        "Team standup moved to 10am starting next week. Please update your calendars. We'll try async standups on Fridays.",
      category: "completely_unrelated",
      expectedAction: "create_new",
    },
  ],
}

/**
 * Scenario: Thread evolution (same topic evolving over conversation)
 *
 * Tests a conversation thread where information builds on itself.
 */
export const THREAD_EVOLUTION: { memo: MemoFixture; threadMessages: MessageFixture[] } = {
  memo: {
    id: "memo_caching_strategy",
    summary: "API responses are cached in Redis with a 5-minute TTL. Cache keys include user ID for personalized data.",
    anchorContent:
      "Question: how should we handle caching for the new API? Answer: Let's use Redis with a 5 min TTL. Include user ID in the key for personalized stuff.",
    confidence: 0.75,
    source: "system",
  },
  threadMessages: [
    {
      id: "msg_thread_1",
      content:
        "Follow-up on the caching discussion: I've implemented the Redis caching. Also added cache invalidation on write operations.",
      category: "thread_update",
      expectedAction: "reinforce",
    },
    {
      id: "msg_thread_2",
      content:
        "Update: we're now using a 2-tier cache - in-memory LRU for hot data (1 min) and Redis (5 min) for everything else. Much faster.",
      category: "thread_evolution",
      expectedAction: "reinforce",
    },
    {
      id: "msg_thread_3",
      content:
        "Final caching architecture: L1 = process memory (1 min), L2 = Redis (5 min), with write-through invalidation. Seeing 40% faster response times.",
      category: "thread_conclusion",
      expectedAction: "supersede",
    },
  ],
}

/**
 * Scenario: User vs system memos (different merge behavior)
 *
 * User-created memos should not be auto-merged into.
 */
export const USER_CREATED_MEMO: { memo: MemoFixture; messages: MessageFixture[] } = {
  memo: {
    id: "memo_user_created",
    summary: "Important: Always use feature flags for new functionality. Ask Sarah before enabling anything in prod.",
    anchorContent:
      "Team policy: all new features must be behind feature flags. Check with Sarah before enabling in production.",
    confidence: 0.95,
    source: "user",
  },
  messages: [
    {
      id: "msg_similar_to_user",
      content:
        "Reminder about feature flags - new stuff needs to be flagged. Get Sarah's approval for prod rollouts.",
      category: "similar_to_user_memo",
      expectedAction: "create_new", // Don't merge into user memos
    },
    {
      id: "msg_slight_update",
      content:
        "Feature flag update: Sarah is out next week, so get approval from Marcus for any prod flag changes.",
      category: "update_related_to_user_memo",
      expectedAction: "create_new", // Don't supersede user memos
    },
  ],
}

/**
 * Scenario: Low confidence memos (easier to supersede)
 *
 * Low confidence memos should be more easily superseded by new info.
 */
export const LOW_CONFIDENCE_MEMO: { memo: MemoFixture; messages: MessageFixture[] } = {
  memo: {
    id: "memo_low_confidence",
    summary: "The staging environment URL might be staging.example.com (needs verification).",
    anchorContent: "I think the staging URL is staging.example.com but not 100% sure.",
    confidence: 0.4,
    source: "system",
  },
  messages: [
    {
      id: "msg_high_confidence_replace",
      content:
        "Confirmed: staging environment is at https://staging.example.com. Added it to the docs. SSL cert is valid.",
      category: "high_confidence_replacement",
      expectedAction: "supersede",
    },
  ],
}

/**
 * All fixtures combined for iteration
 */
export const ALL_FIXTURES = [
  IDENTICAL_MESSAGES,
  SAME_TOPIC_NEW_INFO,
  RELATED_DISTINCT,
  UNRELATED_TOPICS,
  THREAD_EVOLUTION,
  USER_CREATED_MEMO,
  LOW_CONFIDENCE_MEMO,
]

/**
 * Edge cases for testing boundary conditions
 */
export const EDGE_CASES = {
  emptyContent: {
    id: "msg_empty",
    content: "",
    category: "edge_case_empty",
  },
  veryShortContent: {
    id: "msg_short",
    content: "OK",
    category: "edge_case_short",
  },
  veryLongContent: {
    id: "msg_long",
    content: `This is a very long message that contains a lot of information about various topics
including deployment processes, API integrations, database configurations, caching strategies,
authentication mechanisms, and more. The purpose is to test how the system handles large content
that might touch on multiple existing memos. We need to ensure that the similarity matching
doesn't get confused by the breadth of topics and can still identify the primary subject matter.
Additionally, this tests the truncation logic that limits content to a reasonable size for
embedding generation. The system should gracefully handle this case without errors.`.repeat(5),
    category: "edge_case_long",
  },
  codeHeavyContent: {
    id: "msg_code",
    content: `Here's the API endpoint implementation:
\`\`\`typescript
async function handleRequest(req: Request) {
  const data = await fetchData();
  return Response.json(data);
}
\`\`\`
This handles the main request flow.`,
    category: "edge_case_code",
  },
  specialCharacters: {
    id: "msg_special",
    content: "Config: host=localhost; port=5432; user='admin'; password=\"p@ss!w0rd#123\"",
    category: "edge_case_special_chars",
  },
}
