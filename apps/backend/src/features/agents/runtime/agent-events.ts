import type { AgentStepType, TraceSource, AuthorType } from "@threa/types"

// ---------------------------------------------------------------------------
// NewMessageInfo — shared type for new-message checking
// ---------------------------------------------------------------------------

export interface NewMessageInfo {
  sequence: bigint
  messageId: string
  content: string
  authorId: string
  authorName: string
  authorType: AuthorType
  createdAt: string
}

// ---------------------------------------------------------------------------
// AgentEvent — emitted by the runtime, consumed by observers
// ---------------------------------------------------------------------------

export type AgentEvent =
  | { type: "session:start"; sessionId: string; inputSummary?: string }
  | { type: "thinking"; content: string; durationMs: number }
  | { type: "tool:start"; toolCallId: string; toolName: string; input: unknown }
  | {
      type: "tool:complete"
      toolCallId: string
      toolName: string
      input: unknown
      output: string
      durationMs: number
      trace: { stepType: AgentStepType; content: string; sources?: TraceSource[] }
    }
  | { type: "tool:error"; toolCallId: string; toolName: string; error: string; durationMs: number }
  | { type: "message:sent"; messageId: string; content: string; sources?: TraceSource[] }
  | { type: "context:received"; messages: NewMessageInfo[] }
  | { type: "reconsidering"; draft: string; newMessages: NewMessageInfo[] }
  | { type: "session:end"; messagesSent: number; sourceCount: number; lastContent?: string }
  | { type: "session:error"; error: string }
