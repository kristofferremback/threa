/**
 * Ariadne agent eval dataset.
 *
 * Defines test cases for evaluating Ariadne's tool selection,
 * argument accuracy, and response quality.
 */

import type { AriadneMode } from "../../lib/job-queue"

export type ToolName =
  | "search_memos"
  | "search_messages"
  | "get_stream_context"
  | "get_thread_history"
  | "web_search"
  | "fetch_url"

export interface ExpectedToolCall {
  tool: ToolName
  /**
   * Required fields that must be present in the tool arguments.
   * Uses dot notation for nested fields.
   */
  requiredArgs?: string[]
  /**
   * Optional argument matchers for validation.
   * Key is the arg name, value is a regex or exact match.
   */
  argMatchers?: Record<string, string | RegExp>
}

export interface AriadneEvalCase {
  id: string
  /**
   * Scenario category for grouping results.
   */
  scenario:
    | "retrieval_simple"
    | "retrieval_filtered"
    | "thinking_partner"
    | "web_research"
    | "context_gathering"
    | "multi_tool"
    | "no_tools_needed"
  /**
   * The question/prompt to give Ariadne.
   */
  question: string
  /**
   * Agent mode.
   */
  mode: AriadneMode
  /**
   * Expected tool calls in order.
   * If empty, no tools should be called.
   */
  expectedTools: ExpectedToolCall[]
  /**
   * Whether exact tool order matters.
   */
  strictOrder: boolean
  /**
   * Keywords that should appear in the response.
   * Used for basic response quality checks.
   */
  responseKeywords?: string[]
  /**
   * Mock tool responses to use during evaluation.
   * Key is tool name, value is the mock response.
   */
  mockResponses: Record<ToolName, string>
}

export interface AriadneEvalDataset {
  name: string
  version: string
  cases: AriadneEvalCase[]
  createdAt: string
}

/**
 * Build the Ariadne evaluation dataset.
 */
export function buildAriadneDataset(): AriadneEvalDataset {
  const cases: AriadneEvalCase[] = [
    // === RETRIEVAL SIMPLE ===
    {
      id: "retrieval_simple_01",
      scenario: "retrieval_simple",
      question: "What did we decide about the API versioning strategy?",
      mode: "retrieval",
      expectedTools: [{ tool: "search_memos" }, { tool: "search_messages" }],
      strictOrder: false,
      responseKeywords: ["API", "versioning"],
      mockResponses: {
        search_memos:
          "[1] We decided to use URL-based versioning (v1, v2) for the REST API. Major breaking changes warrant new version. Source: #engineering",
        search_messages:
          "[1|evt_123|stream_456] Kris in #engineering (12/1/2024): We should use URL-based versioning for the API.\n\n---\n\n[2|evt_124|stream_456] Stefan in #engineering (12/1/2024): Agreed, URL versioning is cleaner than header-based.",
        get_stream_context: "",
        get_thread_history: "",
        web_search: "",
        fetch_url: "",
      },
    },
    {
      id: "retrieval_simple_02",
      scenario: "retrieval_simple",
      question: "How do we handle authentication in our app?",
      mode: "retrieval",
      expectedTools: [{ tool: "search_memos" }],
      strictOrder: false,
      responseKeywords: ["authentication", "auth"],
      mockResponses: {
        search_memos:
          "[1] Authentication uses WorkOS AuthKit for SSO. JWT tokens are validated on each request. Source: #architecture",
        search_messages: "No messages found matching that query.",
        get_stream_context: "",
        get_thread_history: "",
        web_search: "",
        fetch_url: "",
      },
    },

    // === RETRIEVAL FILTERED ===
    {
      id: "retrieval_filtered_01",
      scenario: "retrieval_filtered",
      question: "What has Kris said about deployment pipelines?",
      mode: "retrieval",
      expectedTools: [
        {
          tool: "search_messages",
          requiredArgs: ["fromUsers"],
          argMatchers: { fromUsers: /kris/i },
        },
      ],
      strictOrder: false,
      responseKeywords: ["deployment", "Kris"],
      mockResponses: {
        search_memos: "No memos found matching that query.",
        search_messages:
          "[1|evt_200|stream_789] Kris in #devops (11/28/2024): Our deployment pipeline should use GitHub Actions with staging environments.",
        get_stream_context: "",
        get_thread_history: "",
        web_search: "",
        fetch_url: "",
      },
    },
    {
      id: "retrieval_filtered_02",
      scenario: "retrieval_filtered",
      question: "Find discussions in #product about the roadmap",
      mode: "retrieval",
      expectedTools: [
        {
          tool: "search_messages",
          requiredArgs: ["inChannels"],
          argMatchers: { inChannels: /product/i },
        },
      ],
      strictOrder: false,
      responseKeywords: ["roadmap", "product"],
      mockResponses: {
        search_memos: "No memos found matching that query.",
        search_messages:
          "[1|evt_300|stream_product] PM in #product (11/25/2024): Q1 roadmap includes auth improvements and mobile app MVP.",
        get_stream_context: "",
        get_thread_history: "",
        web_search: "",
        fetch_url: "",
      },
    },

    // === WEB RESEARCH ===
    {
      id: "web_research_01",
      scenario: "web_research",
      question: "What are the best practices for rate limiting in Node.js?",
      mode: "retrieval",
      expectedTools: [{ tool: "search_memos" }, { tool: "web_search" }],
      strictOrder: false,
      responseKeywords: ["rate limit", "Node"],
      mockResponses: {
        search_memos: "No memos found matching that query.",
        search_messages: "No messages found matching that query.",
        get_stream_context: "",
        get_thread_history: "",
        web_search:
          "**Summary:** Common rate limiting approaches include token bucket, sliding window, and fixed window algorithms.\n\n---\n\n**Sources:**\n\n[1] **Rate Limiting Best Practices**\nhttps://example.com/rate-limiting\nUse Redis for distributed rate limiting...",
        fetch_url: "",
      },
    },
    {
      id: "web_research_02",
      scenario: "web_research",
      question: "Can you explain what this article says? https://example.com/article",
      mode: "retrieval",
      expectedTools: [{ tool: "fetch_url", argMatchers: { url: /example\.com\/article/ } }],
      strictOrder: true,
      responseKeywords: [],
      mockResponses: {
        search_memos: "",
        search_messages: "",
        get_stream_context: "",
        get_thread_history: "",
        web_search: "",
        fetch_url:
          "**Understanding Microservices**\n*A guide to microservices architecture*\n\nMicroservices break applications into small, independent services...",
      },
    },

    // === CONTEXT GATHERING ===
    {
      id: "context_gathering_01",
      scenario: "context_gathering",
      question: "What have we been discussing in this channel recently?",
      mode: "retrieval",
      expectedTools: [{ tool: "get_stream_context" }],
      strictOrder: true,
      responseKeywords: [],
      mockResponses: {
        search_memos: "",
        search_messages: "",
        get_stream_context:
          "Recent messages in #general:\n\n[10:00 AM] Kris: Good morning!\n[10:05 AM] Stefan: Hey! Ready for the sprint planning?\n[10:10 AM] Kris: Yes, let's do it.",
        get_thread_history: "",
        web_search: "",
        fetch_url: "",
      },
    },
    {
      id: "context_gathering_02",
      scenario: "context_gathering",
      question: "Can you read the full thread about database migrations?",
      mode: "retrieval",
      expectedTools: [{ tool: "search_messages" }, { tool: "get_thread_history" }],
      strictOrder: false,
      responseKeywords: ["database", "migration"],
      mockResponses: {
        search_memos: "No memos found matching that query.",
        search_messages:
          "[1|evt_500|stream_thread1] Dev in thread (12/1/2024): We need to add a migration for the new user_settings table.",
        get_stream_context: "",
        get_thread_history:
          "Thread started from message by Dev:\n\"Database migration discussion\"\n\n---\n\nThread messages:\n\n[9:00 AM] Dev: We need to add a migration.\n[9:05 AM] Kris: Use the existing migration pattern.",
        web_search: "",
        fetch_url: "",
      },
    },

    // === MULTI-TOOL ===
    {
      id: "multi_tool_01",
      scenario: "multi_tool",
      question:
        "What did we decide about caching, and what are the industry best practices? Also, what's the current discussion in #backend?",
      mode: "retrieval",
      expectedTools: [
        { tool: "search_memos" },
        { tool: "web_search" },
        { tool: "search_messages", argMatchers: { inChannels: /backend/i } },
      ],
      strictOrder: false,
      responseKeywords: ["caching", "best practices"],
      mockResponses: {
        search_memos: "[1] We decided to use Redis for caching with a 5-minute TTL. Source: #architecture",
        search_messages:
          "[1|evt_600|stream_backend] Dev in #backend (12/1/2024): The caching layer is working well.",
        get_stream_context: "",
        get_thread_history: "",
        web_search:
          "**Summary:** Best practices include cache invalidation strategies, TTL configuration, and using CDN for static assets.",
        fetch_url: "",
      },
    },

    // === THINKING PARTNER ===
    {
      id: "thinking_partner_01",
      scenario: "thinking_partner",
      question: "I'm trying to decide between microservices and a monolith for our new project. What do you think?",
      mode: "thinking_partner",
      expectedTools: [], // Thinking partner mode focuses on discussion, not retrieval
      strictOrder: true,
      responseKeywords: ["microservices", "monolith"],
      mockResponses: {
        search_memos: "",
        search_messages: "",
        get_stream_context: "",
        get_thread_history: "",
        web_search: "",
        fetch_url: "",
      },
    },
    {
      id: "thinking_partner_02",
      scenario: "thinking_partner",
      question: "Help me think through the pros and cons of GraphQL vs REST",
      mode: "thinking_partner",
      expectedTools: [], // May optionally use web_search for context
      strictOrder: false,
      responseKeywords: ["GraphQL", "REST"],
      mockResponses: {
        search_memos: "",
        search_messages: "",
        get_stream_context: "",
        get_thread_history: "",
        web_search: "",
        fetch_url: "",
      },
    },

    // === NO TOOLS NEEDED ===
    {
      id: "no_tools_01",
      scenario: "no_tools_needed",
      question: "Thanks for your help!",
      mode: "retrieval",
      expectedTools: [],
      strictOrder: true,
      responseKeywords: [],
      mockResponses: {
        search_memos: "",
        search_messages: "",
        get_stream_context: "",
        get_thread_history: "",
        web_search: "",
        fetch_url: "",
      },
    },
    {
      id: "no_tools_02",
      scenario: "no_tools_needed",
      question: "What is 2 + 2?",
      mode: "retrieval",
      expectedTools: [],
      strictOrder: true,
      responseKeywords: ["4"],
      mockResponses: {
        search_memos: "",
        search_messages: "",
        get_stream_context: "",
        get_thread_history: "",
        web_search: "",
        fetch_url: "",
      },
    },
  ]

  return {
    name: "ariadne-agent-v1",
    version: "1.0.0",
    cases,
    createdAt: new Date().toISOString(),
  }
}

/**
 * Get dataset statistics.
 */
export function getAriadneDatasetStats(dataset: AriadneEvalDataset): {
  total: number
  byScenario: Record<string, number>
  byMode: Record<string, number>
  avgExpectedTools: number
} {
  const byScenario: Record<string, number> = {}
  const byMode: Record<string, number> = {}
  let totalExpectedTools = 0

  for (const c of dataset.cases) {
    byScenario[c.scenario] = (byScenario[c.scenario] || 0) + 1
    byMode[c.mode] = (byMode[c.mode] || 0) + 1
    totalExpectedTools += c.expectedTools.length
  }

  return {
    total: dataset.cases.length,
    byScenario,
    byMode,
    avgExpectedTools: totalExpectedTools / dataset.cases.length,
  }
}
