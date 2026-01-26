import type { AgentStepType } from "@threa/types"

const STEP_TYPE_LABELS: Record<AgentStepType, string> = {
  thinking: "Thinking...",
  web_search: "Searching the web...",
  visit_page: "Reading a page...",
  workspace_search: "Searching the workspace...",
  message_sent: "Sent a message",
  tool_call: "Using a tool...",
  tool_error: "Encountered an error",
}

export function getStepLabel(stepType: AgentStepType): string {
  return STEP_TYPE_LABELS[stepType] ?? "Working..."
}

const STEP_TYPE_ICONS: Record<AgentStepType, string> = {
  thinking: "💭",
  web_search: "🔍",
  visit_page: "📄",
  workspace_search: "🏢",
  message_sent: "💬",
  tool_call: "🔧",
  tool_error: "⚠️",
}

export function getStepIcon(stepType: AgentStepType): string {
  return STEP_TYPE_ICONS[stepType] ?? "⚙️"
}
