/**
 * Test cases for memorizer evaluation suite.
 *
 * Each case tests the memorizer's ability to:
 * - Extract key information into self-contained memos
 * - Normalize relative dates to absolute dates
 * - Resolve pronouns when context is clear
 */

import type { EvalCase } from "../../framework/types"
import type { Message } from "../../../src/repositories"

/**
 * Input for a memorizer case.
 */
export interface MemorizerInput {
  /** Message content in markdown format */
  content: string
  /** Optional memory context (prior memo abstracts) */
  memoryContext?: string[]
  /** Optional existing tags */
  existingTags?: string[]
  /** Author timezone for date resolution */
  authorTimezone?: string
}

/**
 * Expected output characteristics for a memorizer case.
 * Rather than exact match, we check for key characteristics.
 */
export interface MemorizerExpected {
  /** Key phrases that should appear in the abstract */
  abstractContains?: string[]
  /** Key phrases that should NOT appear in the abstract (e.g., unresolved pronouns) */
  abstractNotContains?: string[]
  /** Minimum number of key points expected */
  minKeyPoints?: number
  /** Tags that should be included */
  expectedTags?: string[]
  /** Title should contain these terms */
  titleContains?: string[]
}

/**
 * Create a test message from input.
 */
export function createTestMessage(content: string, messageId: string, authorId: string): Message {
  return {
    id: messageId,
    streamId: "stream_test",
    sequence: BigInt(1),
    authorId,
    authorType: "member",
    contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: content }] }] },
    contentMarkdown: content,
    replyCount: 0,
    reactions: {},
    editedAt: null,
    deletedAt: null,
    createdAt: new Date(),
  }
}

/**
 * Test cases for the memorizer.
 *
 * Categories:
 * - date-norm: Date normalization (relative → absolute)
 * - pronoun: Pronoun resolution
 * - extraction: Information extraction quality
 * - tags: Tag generation
 */
export const memorizerCases: EvalCase<MemorizerInput, MemorizerExpected>[] = [
  // =========================================================================
  // DATE NORMALIZATION - Converting relative dates to absolute dates
  // =========================================================================
  {
    id: "date-norm-001",
    name: "Normalize 'tomorrow' to actual date",
    input: {
      content:
        "We're launching the new payment feature tomorrow. All teams should be ready for increased support volume.",
      authorTimezone: "America/New_York",
    },
    expectedOutput: {
      // The abstract should contain an actual date, not "tomorrow"
      abstractNotContains: ["tomorrow"],
      abstractContains: ["payment feature", "launch"],
      titleContains: ["payment", "launch"],
    },
  },
  {
    id: "date-norm-002",
    name: "Normalize 'next week' to actual date",
    input: {
      content:
        "The API deprecation deadline is next week. Make sure all clients have migrated to v2 endpoints by then.",
      authorTimezone: "Europe/London",
    },
    expectedOutput: {
      abstractNotContains: ["next week"],
      abstractContains: ["API", "deprecation", "v2"],
    },
  },
  {
    id: "date-norm-003",
    name: "Preserve explicit dates",
    input: {
      content:
        "The quarterly review is scheduled for March 15th, 2024. All project leads need to prepare status updates.",
      authorTimezone: "America/Los_Angeles",
    },
    expectedOutput: {
      // Explicit dates should be preserved
      abstractContains: ["March 15", "quarterly review"],
      titleContains: ["quarterly", "review"],
    },
  },
  {
    id: "date-norm-004",
    name: "Handle 'yesterday' in context",
    input: {
      content:
        "We discovered a critical bug yesterday that was causing data loss for enterprise customers. The fix has been deployed and verified.",
      authorTimezone: "UTC",
    },
    expectedOutput: {
      abstractNotContains: ["yesterday"],
      abstractContains: ["critical bug", "data loss", "enterprise", "fix", "deployed"],
    },
  },

  // =========================================================================
  // INFORMATION EXTRACTION - Quality of extracted content
  // =========================================================================
  {
    id: "extraction-001",
    name: "Extract decision with rationale",
    input: {
      content:
        "After benchmarking both options, we've decided to use Postgres over MongoDB for user data. Key factors: 1) Our queries are highly relational, 2) We need transactions for payment flows, 3) Better team familiarity with SQL. This affects our data layer architecture going forward.",
    },
    expectedOutput: {
      abstractContains: ["Postgres", "MongoDB", "relational", "transactions", "payment"],
      minKeyPoints: 3,
      expectedTags: ["database", "architecture"],
    },
  },
  {
    id: "extraction-002",
    name: "Extract procedure steps",
    input: {
      content:
        "Deployment process for production: 1) Create PR with version bump, 2) Wait for CI to pass, 3) Get approval from on-call, 4) Merge to main, 5) Monitor error rates for 30 minutes post-deploy. If errors spike, roll back immediately.",
    },
    expectedOutput: {
      abstractContains: ["deployment", "production", "CI", "approval", "monitor", "roll back"],
      minKeyPoints: 4,
      expectedTags: ["deployment", "production"],
    },
  },
  {
    id: "extraction-003",
    name: "Extract incident learning",
    input: {
      content:
        "Post-mortem: The outage was caused by database connection pool exhaustion. AI calls were holding connections for 5-10 seconds during generation. Solution: implement three-phase pattern - fetch data, release connection, do AI work, reconnect to save. This reduced connection hold time from seconds to milliseconds.",
    },
    expectedOutput: {
      abstractContains: ["connection pool", "AI", "three-phase", "milliseconds"],
      minKeyPoints: 2,
      expectedTags: ["incident", "database", "performance"],
    },
  },

  // =========================================================================
  // TAG GENERATION - Using existing tags when appropriate
  // =========================================================================
  {
    id: "tags-001",
    name: "Reuse existing relevant tags",
    input: {
      content:
        "We're switching from REST to GraphQL for the mobile API. This will reduce over-fetching and improve app performance.",
      existingTags: ["api", "graphql", "mobile", "performance", "backend"],
    },
    expectedOutput: {
      abstractContains: ["GraphQL", "REST", "mobile", "performance"],
      // Should prefer existing tags over creating new ones
      expectedTags: ["api", "graphql", "mobile"],
    },
  },
  {
    id: "tags-002",
    name: "Create new tags when needed",
    input: {
      content:
        "Implemented rate limiting using a token bucket algorithm. Each user gets 100 tokens per minute, with burst capacity of 20 for spikes.",
      existingTags: ["api", "backend", "security"],
    },
    expectedOutput: {
      abstractContains: ["rate limiting", "token bucket", "100 tokens", "burst"],
      // May create new tags like "rate-limiting" if not in existing
      minKeyPoints: 2,
    },
  },

  // =========================================================================
  // SELF-CONTAINMENT - Memos should stand alone
  // =========================================================================
  {
    id: "self-contained-001",
    name: "Provide context for acronyms",
    input: {
      content:
        "The LCP is too high on our landing page. We need to optimize the hero image and lazy load below-fold content to improve CWV scores.",
    },
    expectedOutput: {
      // Good memo would expand acronyms or provide context
      abstractContains: ["landing page", "hero image", "lazy load"],
      titleContains: ["performance"],
    },
  },
  {
    id: "self-contained-002",
    name: "Include relevant numbers",
    input: {
      content:
        "After the optimization, p99 latency dropped from 2.3s to 450ms. Memory usage is down 40%. The change is safe to ship.",
    },
    expectedOutput: {
      // Numbers should be preserved as they're important facts
      abstractContains: ["2.3s", "450ms", "40%", "latency"],
      titleContains: ["optimization", "performance"],
    },
  },

  // =========================================================================
  // EDGE CASES
  // =========================================================================
  {
    id: "edge-001",
    name: "Handle markdown formatting",
    input: {
      content: `Configuration options for the cache:
- \`MAX_SIZE\`: Maximum cache size in MB (default: 512)
- \`TTL\`: Time-to-live in seconds (default: 3600)
- \`STRATEGY\`: Eviction strategy, either "lru" or "fifo"

Set these in your .env file before starting the server.`,
    },
    expectedOutput: {
      abstractContains: ["cache", "MAX_SIZE", "TTL", "STRATEGY", ".env"],
      minKeyPoints: 3,
      expectedTags: ["configuration", "cache"],
    },
  },
  {
    id: "edge-002",
    name: "Handle code snippets",
    input: {
      content:
        "To enable debug logging, add this to your config: `DEBUG=app:*` or for specific modules `DEBUG=app:db,app:auth`. The logs will include timestamps and module names.",
    },
    expectedOutput: {
      abstractContains: ["debug", "logging", "DEBUG=", "config"],
      titleContains: ["debug", "logging"],
    },
  },
  {
    id: "edge-003",
    name: "Multiple relative dates",
    input: {
      content:
        "Timeline update: Design review was yesterday, implementation starts today, and the feature should be ready for QA by next Friday. Final release is planned for end of month.",
      authorTimezone: "America/Chicago",
    },
    expectedOutput: {
      // All relative dates should be normalized
      abstractNotContains: ["yesterday", "today", "next Friday"],
      abstractContains: ["design review", "implementation", "QA", "release"],
    },
  },
]
