/**
 * Types for Companion Agent Evaluation
 */

import type { CompanionInput, CompanionExpected } from "./cases"
import type { SourceItem } from "@threa/types"

/**
 * A message sent by the companion agent.
 */
export interface CompanionMessage {
  /** Message content */
  content: string
  /** Optional sources (from web search, workspace search) */
  sources?: SourceItem[]
}

/**
 * Output from the companion agent evaluation task.
 */
export interface CompanionOutput {
  /** The input that was provided */
  input: CompanionInput
  /** Messages sent by the agent (may be empty if agent decided not to respond) */
  messages: CompanionMessage[]
  /** Whether the agent decided to respond */
  responded: boolean
  /** Tool calls made during processing */
  toolCalls?: Array<{
    name: string
    args: Record<string, unknown>
  }>
  /** Error if the task failed */
  error?: string
}

// Re-export input and expected types
export type { CompanionInput, CompanionExpected }
