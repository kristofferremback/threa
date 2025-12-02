/**
 * Ariadne agent eval dataset.
 *
 * Defines test cases for evaluating Ariadne's tool selection,
 * argument accuracy, and retrieval quality against seeded test data.
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
   * Expected source IDs that should be found in the response.
   * These reference event IDs or memo IDs from the seeded data.
   */
  expectedSourceIds?: string[]
  /**
   * Keywords that should appear in the response.
   * Used for basic response quality checks.
   */
  responseKeywords?: string[]
}

export interface AriadneEvalDataset {
  name: string
  version: string
  cases: AriadneEvalCase[]
  createdAt: string
}

/**
 * Build the Ariadne evaluation dataset.
 * Test cases reference seeded data from seed-data.ts.
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
      expectedSourceIds: ["evt_eval_api_v1", "evt_eval_api_v2"],
      responseKeywords: ["API", "versioning", "URL-based", "v1", "v2"],
    },
    {
      id: "retrieval_simple_02",
      scenario: "retrieval_simple",
      question: "How do we handle authentication in our app?",
      mode: "retrieval",
      expectedTools: [{ tool: "search_memos" }],
      strictOrder: false,
      expectedSourceIds: ["evt_eval_auth_1"],
      responseKeywords: ["authentication", "WorkOS", "JWT"],
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
      expectedSourceIds: ["evt_eval_deploy_1"],
      responseKeywords: ["deployment", "GitHub Actions", "staging"],
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
      expectedSourceIds: ["evt_eval_roadmap_1"],
      responseKeywords: ["roadmap", "Q1", "mobile"],
    },

    // === WEB RESEARCH ===
    // Note: web_search and fetch_url require external API (Tavily)
    // These cases test that the agent correctly chooses to use web search
    {
      id: "web_research_01",
      scenario: "web_research",
      question: "What are the best practices for rate limiting in Node.js according to the web?",
      mode: "retrieval",
      expectedTools: [{ tool: "search_memos" }, { tool: "web_search" }],
      strictOrder: false,
      responseKeywords: ["rate limit"],
    },
    {
      id: "web_research_02",
      scenario: "web_research",
      question: "Can you explain what this article says? https://example.com/article",
      mode: "retrieval",
      expectedTools: [{ tool: "fetch_url", argMatchers: { url: /example\.com\/article/ } }],
      strictOrder: true,
      responseKeywords: [],
    },

    // === CONTEXT GATHERING ===
    {
      id: "context_gathering_01",
      scenario: "context_gathering",
      question: "What have we been discussing in this channel recently?",
      mode: "retrieval",
      expectedTools: [{ tool: "get_stream_context" }],
      strictOrder: true,
      expectedSourceIds: ["evt_eval_recent_1", "evt_eval_recent_2", "evt_eval_recent_3"],
      responseKeywords: ["morning", "sprint planning"],
    },
    {
      id: "context_gathering_02",
      scenario: "context_gathering",
      question: "Can you read the full thread about database migrations?",
      mode: "retrieval",
      expectedTools: [{ tool: "search_messages" }, { tool: "get_thread_history" }],
      strictOrder: false,
      expectedSourceIds: ["evt_eval_migration_root", "evt_eval_migration_reply1", "evt_eval_migration_reply2"],
      responseKeywords: ["database", "migration", "user_settings"],
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
      expectedSourceIds: ["evt_eval_caching_1"],
      responseKeywords: ["caching", "Redis", "TTL"],
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
    },
    {
      id: "thinking_partner_02",
      scenario: "thinking_partner",
      question: "Help me think through the pros and cons of GraphQL vs REST",
      mode: "thinking_partner",
      expectedTools: [], // May optionally use web_search for context
      strictOrder: false,
      responseKeywords: ["GraphQL", "REST"],
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
    },
    {
      id: "no_tools_02",
      scenario: "no_tools_needed",
      question: "What is 2 + 2?",
      mode: "retrieval",
      expectedTools: [],
      strictOrder: true,
      responseKeywords: ["4"],
    },
  ]

  return {
    name: "ariadne-agent-v2",
    version: "2.0.0",
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
