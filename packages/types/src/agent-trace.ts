import type { AgentSessionStatus, AgentStepType } from "./constants"

// Source types for trace steps
export const TRACE_SOURCE_TYPES = ["web", "workspace", "workspace_message", "workspace_memo"] as const
export type TraceSourceType = (typeof TRACE_SOURCE_TYPES)[number]

export interface TraceSource {
  type: TraceSourceType
  title: string
  url?: string
  domain?: string
  snippet?: string
  streamId?: string
  streamName?: string
  messageId?: string
  authorName?: string
  timestamp?: string
}

// Agent session step (wire format for API responses)
export interface AgentSessionStep {
  id: string
  sessionId: string
  stepNumber: number
  stepType: AgentStepType
  content?: string
  sources?: TraceSource[]
  messageId?: string
  duration?: number
  tokensUsed?: number
  startedAt: string
  completedAt?: string
}

// Agent session (wire format for API responses)
export interface AgentSession {
  id: string
  streamId: string
  personaId: string
  triggerMessageId: string
  status: AgentSessionStatus
  currentStepType?: AgentStepType
  sentMessageIds: string[]
  createdAt: string
  completedAt?: string
}

// API response for fetching a session with steps
export interface AgentSessionWithSteps {
  session: AgentSession
  steps: AgentSessionStep[]
  persona: {
    id: string
    name: string
    avatarUrl: string | null
    avatarEmoji?: string | null
  }
}

// Real-time socket event for cross-stream activity
// Backend sends semantic stepType, frontend maps to display labels
export interface AgentActivityUpdate {
  sessionId: string
  personaName: string
  stepType: AgentStepType | null
}

// Real-time progress payload (emitted per step to stream room, not persisted)
export interface AgentSessionProgressPayload {
  workspaceId: string
  streamId: string
  sessionId: string
  stepCount: number
  currentStepType: AgentStepType
}

// Stream event payloads for agent session lifecycle
export interface AgentSessionStartedPayload {
  sessionId: string
  personaId: string
  personaName: string
  triggerMessageId: string
  startedAt: string
}

export interface AgentSessionCompletedPayload {
  sessionId: string
  stepCount: number
  messageCount: number
  duration: number
  completedAt: string
}

export interface AgentSessionFailedPayload {
  sessionId: string
  stepCount: number
  error: string
  traceId: string
  failedAt: string
}

// Session-room socket event payloads (for trace dialog real-time updates)
export interface StepStartedPayload {
  sessionId: string
  step: AgentSessionStep
}

export interface StepProgressPayload {
  sessionId: string
  stepId: string
  content?: string
}

export interface StepCompletedPayload {
  sessionId: string
  step: AgentSessionStep
}

export interface SessionTerminalPayload {
  sessionId: string
}
