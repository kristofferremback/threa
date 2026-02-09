/**
 * Test cases for memo-classifier evaluation suite.
 *
 * Each case tests whether the classifier correctly identifies
 * knowledge-worthy messages (gems) vs. non-worthy messages.
 */

import type { EvalCase } from "../../framework/types"
import type { MessageClassification } from "../../../src/features/memos"
import type { Message } from "../../../src/features/messaging"

/**
 * Input for a classification case.
 * Contains the message content to classify.
 */
export interface ClassifierInput {
  /** Message content in markdown format */
  content: string
  /** Author type (default: "user") */
  authorType?: "member" | "persona"
}

/**
 * Expected output for a classification case.
 */
export interface ClassifierExpected {
  /** Whether the message should be classified as a gem */
  isGem: boolean
  /** Expected knowledge type if isGem is true */
  knowledgeType?: "decision" | "learning" | "procedure" | "context" | "reference" | null
}

/**
 * Create a test message from input.
 */
export function createTestMessage(input: ClassifierInput, messageId: string, authorId: string): Message {
  return {
    id: messageId,
    streamId: "stream_test",
    sequence: BigInt(1),
    authorId,
    authorType: input.authorType ?? "member",
    contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: input.content }] }] },
    contentMarkdown: input.content,
    replyCount: 0,
    reactions: {},
    editedAt: null,
    deletedAt: null,
    createdAt: new Date(),
  }
}

/**
 * Test cases for the memo-classifier.
 *
 * Categories:
 * - gem-decision: Messages that capture decisions with rationale
 * - gem-learning: Messages that share learnings or insights
 * - gem-procedure: Messages that document how-to instructions
 * - gem-context: Messages that provide project/team context
 * - gem-reference: Messages with reference information
 * - non-gem: Messages that shouldn't be classified as gems
 */
export const classifierCases: EvalCase<ClassifierInput, ClassifierExpected>[] = [
  // =========================================================================
  // DECISION GEMS - Messages that capture decisions with rationale
  // =========================================================================
  {
    id: "gem-decision-001",
    name: "Decision with clear rationale",
    input: {
      content:
        "We've decided to use PostgreSQL instead of MongoDB for the user data. The main reasons are: 1) Our data is highly relational with complex queries, 2) We need ACID compliance for financial transactions, 3) The team has more experience with SQL. This will affect the data layer architecture.",
    },
    expectedOutput: {
      isGem: true,
      knowledgeType: "decision",
    },
  },
  {
    id: "gem-decision-002",
    name: "Architecture decision",
    input: {
      content:
        "After reviewing the options, we're going with a microservices architecture for the payment system. The monolith approach would be simpler initially, but we anticipate needing to scale the payment processing independently. The trade-off is increased operational complexity.",
    },
    expectedOutput: {
      isGem: true,
      knowledgeType: "decision",
    },
  },
  {
    id: "gem-decision-003",
    name: "Technical decision with trade-offs",
    input: {
      content:
        "We'll use Redis for caching instead of in-memory caching. Yes, it adds infrastructure complexity, but we need the cache to survive server restarts and be shared across instances when we scale horizontally.",
    },
    expectedOutput: {
      isGem: true,
      knowledgeType: "decision",
    },
  },

  // =========================================================================
  // LEARNING GEMS - Messages that share learnings or insights
  // =========================================================================
  {
    id: "gem-learning-001",
    name: "Debugging insight",
    input: {
      content:
        "Found the root cause of the memory leak! The WebSocket connections weren't being cleaned up properly when users disconnected. The issue was that we were adding event listeners but never removing them. Fixed by implementing proper cleanup in the disconnect handler.",
    },
    expectedOutput: {
      isGem: true,
      knowledgeType: "learning",
    },
  },
  {
    id: "gem-learning-002",
    name: "Performance optimization discovery",
    input: {
      content:
        "Interesting finding: moving our image processing to a worker thread reduced API response times by 40%. The CPU-intensive operations were blocking the event loop. Lesson learned: always consider offloading heavy computation in Node.js.",
    },
    expectedOutput: {
      isGem: true,
      knowledgeType: "learning",
    },
  },
  {
    id: "gem-learning-003",
    name: "Incident post-mortem insight",
    input: {
      content:
        "Post-mortem from yesterday's outage: The database connection pool was exhausted because long-running AI calls were holding connections. We need to implement the three-phase pattern - fetch data, release connection, do AI work, reconnect to save results.",
    },
    expectedOutput: {
      isGem: true,
      knowledgeType: "learning",
    },
  },

  // =========================================================================
  // PROCEDURE GEMS - Messages that document how-to instructions
  // =========================================================================
  {
    id: "gem-procedure-001",
    name: "Deployment process",
    input: {
      content:
        "Here's how to deploy to production: 1) Run `bun run build` to create the production bundle, 2) Run `bun run test` to verify all tests pass, 3) Create a PR with the version bump, 4) After merge, tag the release with `git tag v1.x.x`, 5) Push the tag to trigger the CI/CD pipeline.",
    },
    expectedOutput: {
      isGem: true,
      knowledgeType: "procedure",
    },
  },
  {
    id: "gem-procedure-002",
    name: "Debugging steps",
    input: {
      content:
        "When investigating slow queries: First, enable query logging with `SET log_statement = 'all'`. Then run EXPLAIN ANALYZE on the problematic query. Look for sequential scans on large tables - those usually need indexes. Check if the query planner's row estimates are way off from actual rows.",
    },
    expectedOutput: {
      isGem: true,
      knowledgeType: "procedure",
    },
  },

  // =========================================================================
  // CONTEXT GEMS - Messages that provide project/team context
  // =========================================================================
  {
    id: "gem-context-001",
    name: "Project history context",
    input: {
      content:
        "Quick context on why we have both v1 and v2 APIs: The v1 API was built for web only, but when we added the mobile app we needed different response formats and pagination. Rather than breaking existing web clients, we created v2. We're slowly migrating web to v2 but need to maintain v1 until Q3.",
    },
    expectedOutput: {
      isGem: true,
      knowledgeType: "context",
    },
  },
  {
    id: "gem-context-002",
    name: "Technical debt explanation",
    input: {
      content:
        "The reason we have that weird workaround in the auth middleware is because of a bug in the OAuth library that wasn't fixed until 2.0. We're stuck on 1.8 because 2.0 has breaking changes we haven't had time to address. The workaround is safe but confusing without this context.",
    },
    expectedOutput: {
      isGem: true,
      knowledgeType: "context",
    },
  },

  // =========================================================================
  // REFERENCE GEMS - Messages with reference information
  // =========================================================================
  {
    id: "gem-reference-001",
    name: "API documentation reference",
    input: {
      content:
        "API rate limits for reference: Free tier gets 100 requests/minute, Pro tier gets 1000/minute, Enterprise is unlimited. Rate limit headers are X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset. We return 429 when exceeded with a Retry-After header.",
    },
    expectedOutput: {
      isGem: true,
      knowledgeType: "reference",
    },
  },
  {
    id: "gem-reference-002",
    name: "Configuration reference",
    input: {
      content:
        "Environment variables for the AI service: OPENROUTER_API_KEY (required), AI_MODEL (default: claude-haiku-4.5), AI_TEMPERATURE (default: 0.7), AI_MAX_TOKENS (default: 4096). Set AI_DEBUG=true for verbose logging of prompts and responses.",
    },
    expectedOutput: {
      isGem: true,
      knowledgeType: "reference",
    },
  },

  // =========================================================================
  // NON-GEMS - Messages that shouldn't be classified as knowledge-worthy
  // =========================================================================
  {
    id: "non-gem-001",
    name: "Simple acknowledgment",
    input: {
      content: "Got it, thanks!",
    },
    expectedOutput: {
      isGem: false,
      knowledgeType: null,
    },
  },
  {
    id: "non-gem-002",
    name: "Status update without context",
    input: {
      content: "Working on the feature now, should be done soon.",
    },
    expectedOutput: {
      isGem: false,
      knowledgeType: null,
    },
  },
  {
    id: "non-gem-003",
    name: "Question without answer",
    input: {
      content: "Has anyone tried using the new testing framework? I'm wondering if it's worth switching.",
    },
    expectedOutput: {
      isGem: false,
      knowledgeType: null,
    },
  },
  {
    id: "non-gem-004",
    name: "Social chat",
    input: {
      content: "Happy Friday everyone! Anyone have fun plans for the weekend?",
    },
    expectedOutput: {
      isGem: false,
      knowledgeType: null,
    },
  },
  {
    id: "non-gem-005",
    name: "Brief status",
    input: {
      content: "Done.",
    },
    expectedOutput: {
      isGem: false,
      knowledgeType: null,
    },
  },
  {
    id: "non-gem-006",
    name: "Incomplete thought",
    input: {
      content: "Actually wait, let me think about this more...",
    },
    expectedOutput: {
      isGem: false,
      knowledgeType: null,
    },
  },
  {
    id: "non-gem-007",
    name: "Meeting coordination",
    input: {
      content: "Can we move the standup to 10am tomorrow? I have a conflict at 9.",
    },
    expectedOutput: {
      isGem: false,
      knowledgeType: null,
    },
  },
  {
    id: "non-gem-008",
    name: "Simple approval",
    input: {
      content: "LGTM, ship it!",
    },
    expectedOutput: {
      isGem: false,
      knowledgeType: null,
    },
  },

  // =========================================================================
  // EDGE CASES - Borderline cases to test classifier robustness
  // =========================================================================
  {
    id: "edge-001",
    name: "Short but valuable",
    input: {
      content:
        "Use `bun run test:watch` for faster feedback during development - it only reruns tests for changed files.",
    },
    expectedOutput: {
      isGem: true,
      knowledgeType: "procedure",
    },
  },
  {
    id: "edge-002",
    name: "Question with embedded knowledge",
    input: {
      content:
        "Why do we use ULIDs instead of UUIDs? Is it because they're sortable by time? That would explain why our queries on created_at are fast even without explicit ordering.",
    },
    expectedOutput: {
      isGem: false, // Questions typically need answers to be valuable
      knowledgeType: null,
    },
  },
  {
    id: "edge-003",
    name: "Persona message (AI)",
    input: {
      content:
        "Based on my analysis, I recommend implementing the feature using a queue-based approach. This will handle load spikes better than synchronous processing.",
      authorType: "persona",
    },
    expectedOutput: {
      isGem: false, // Persona messages are filtered out
      knowledgeType: null,
    },
  },
]
