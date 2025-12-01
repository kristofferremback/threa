/**
 * Eval dataset management.
 *
 * Converts test fixtures into eval cases and tracks expected outcomes.
 */

import {
  ALL_FIXTURES,
  EDGE_CASES,
  type MemoFixture,
  type MessageFixture,
} from "../services/memo-evolution/__tests__/test-fixtures"

export interface EvalCase {
  id: string
  scenario: string
  category: string
  memoSummary: string
  memoAnchorContent: string
  memoConfidence: number
  memoSource: "user" | "system" | "ariadne"
  newMessageContent: string
  expectedAction: "create_new" | "reinforce" | "supersede" | "skip"
  expectedSameTopic: boolean
}

export interface EvalDataset {
  name: string
  version: string
  cases: EvalCase[]
  createdAt: string
}

/**
 * Build eval dataset from test fixtures.
 */
export function buildDatasetFromFixtures(): EvalDataset {
  const cases: EvalCase[] = []

  for (const fixture of ALL_FIXTURES) {
    const memo = fixture.memo
    const messages = "messages" in fixture ? fixture.messages : fixture.threadMessages

    for (const msg of messages) {
      if (!msg.expectedAction) continue

      const expectedSameTopic = determineExpectedSameTopic(msg.expectedAction, msg.category)

      cases.push({
        id: `${memo.id}_${msg.id}`,
        scenario: getScenarioName(fixture),
        category: msg.category,
        memoSummary: memo.summary,
        memoAnchorContent: memo.anchorContent,
        memoConfidence: memo.confidence,
        memoSource: memo.source,
        newMessageContent: msg.content,
        expectedAction: msg.expectedAction,
        expectedSameTopic,
      })
    }
  }

  return {
    name: "memo-evolution-v1",
    version: "1.0.0",
    cases,
    createdAt: new Date().toISOString(),
  }
}

/**
 * Get scenario name from fixture type.
 */
function getScenarioName(fixture: (typeof ALL_FIXTURES)[number]): string {
  const memo = fixture.memo
  if (memo.id.includes("deploy")) return "identical_messages"
  if (memo.id.includes("rate_limit")) return "same_topic_new_info"
  if (memo.id.includes("oauth")) return "related_distinct"
  if (memo.id.includes("backup")) return "unrelated_topics"
  if (memo.id.includes("caching")) return "thread_evolution"
  if (memo.id.includes("user_created")) return "user_created_memo"
  if (memo.id.includes("low_confidence")) return "low_confidence_memo"
  return "unknown"
}

/**
 * Determine expected same_topic value based on action and category.
 */
function determineExpectedSameTopic(
  action: "create_new" | "reinforce" | "supersede" | "skip",
  category: string,
): boolean {
  // Actions that imply same topic
  if (action === "reinforce" || action === "supersede" || action === "skip") {
    return true
  }

  // create_new can be same topic (e.g., for user memos) or different topic
  if (category.includes("unrelated") || category.includes("different")) {
    return false
  }

  // Borderline - related topics that create new memos
  if (category.includes("related")) {
    return false
  }

  // user memo protection - same topic but still create_new
  if (category.includes("user_memo") || category.includes("similar_to_user")) {
    return true
  }

  return false
}

/**
 * Filter dataset by scenario.
 */
export function filterByScenario(dataset: EvalDataset, scenario: string): EvalCase[] {
  return dataset.cases.filter((c) => c.scenario === scenario)
}

/**
 * Filter dataset by expected action.
 */
export function filterByAction(
  dataset: EvalDataset,
  action: "create_new" | "reinforce" | "supersede" | "skip",
): EvalCase[] {
  return dataset.cases.filter((c) => c.expectedAction === action)
}

/**
 * Get dataset statistics.
 */
export function getDatasetStats(dataset: EvalDataset): {
  total: number
  byScenario: Record<string, number>
  byAction: Record<string, number>
  bySameTopic: { yes: number; no: number }
} {
  const byScenario: Record<string, number> = {}
  const byAction: Record<string, number> = {}
  let sameTopicYes = 0
  let sameTopicNo = 0

  for (const c of dataset.cases) {
    byScenario[c.scenario] = (byScenario[c.scenario] || 0) + 1
    byAction[c.expectedAction] = (byAction[c.expectedAction] || 0) + 1
    if (c.expectedSameTopic) {
      sameTopicYes++
    } else {
      sameTopicNo++
    }
  }

  return {
    total: dataset.cases.length,
    byScenario,
    byAction,
    bySameTopic: { yes: sameTopicYes, no: sameTopicNo },
  }
}
