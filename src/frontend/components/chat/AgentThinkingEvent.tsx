import { useState } from "react"
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  Brain,
  Wrench,
  FileText,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronRight,
  Copy,
  Check,
  Maximize2,
  ExternalLink,
} from "lucide-react"
import { useToolResultPanel } from "./ToolResultViewer"

// Types matching the backend
export interface SessionStep {
  id: string
  type: "gathering_context" | "reasoning" | "tool_call" | "synthesizing"
  content: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_result?: string
  started_at: string
  completed_at?: string
  status: "active" | "completed" | "failed"
}

export interface AgentSession {
  id: string
  streamId: string // The stream where this session lives (thread or channel)
  triggeringEventId: string
  responseEventId: string | null
  status: "active" | "summarizing" | "completed" | "failed"
  steps: SessionStep[]
  summary: string | null
  errorMessage: string | null
  startedAt: string
  completedAt: string | null
}

interface AgentThinkingEventProps {
  session: AgentSession
  isLinkedToResponse?: boolean // True if response is rendered below this
  className?: string
}

const stepIcons: Record<SessionStep["type"], typeof Brain> = {
  gathering_context: FileText,
  reasoning: Brain,
  tool_call: Wrench,
  synthesizing: Sparkles,
}

const stepLabels: Record<SessionStep["type"], string> = {
  gathering_context: "Gathering context",
  reasoning: "Thinking",
  tool_call: "Using tool",
  synthesizing: "Preparing response",
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  const start = new Date(startedAt).getTime()
  const end = completedAt ? new Date(completedAt).getTime() : Date.now()
  const durationSec = (end - start) / 1000

  if (durationSec < 1) return "<1s"
  if (durationSec < 60) return `${durationSec.toFixed(1)}s`
  return `${Math.floor(durationSec / 60)}m ${Math.floor(durationSec % 60)}s`
}

function formatStepDuration(step: SessionStep): string {
  if (!step.completed_at) return ""
  const start = new Date(step.started_at).getTime()
  const end = new Date(step.completed_at).getTime()
  const durationSec = (end - start) / 1000
  if (durationSec < 0.1) return ""
  return `${durationSec.toFixed(1)}s`
}

/**
 * Individual step component with expandable details
 */
function StepItem({ step }: { step: SessionStep }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const { setExpandedStep } = useToolResultPanel()

  const Icon = stepIcons[step.type]
  const isStepActive = step.status === "active"
  const isStepFailed = step.status === "failed"
  const stepDuration = formatStepDuration(step)
  const hasDetails = step.type === "tool_call" && (step.tool_input || step.tool_result)
  const hasToolResult = step.type === "tool_call" && step.tool_result && step.status === "completed"

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (step.tool_result) {
      await navigator.clipboard.writeText(step.tool_result)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleExpand = (e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedStep(step)
  }

  return (
    <div className="group">
      {/* Step header */}
      <button
        onClick={() => hasDetails && setIsExpanded(!isExpanded)}
        className={`w-full flex items-start gap-2 text-sm py-1 ${hasDetails ? "cursor-pointer hover:bg-[var(--hover-overlay)] -mx-2 px-2 rounded" : ""}`}
        style={{
          color: isStepActive ? "var(--text-primary)" : isStepFailed ? "var(--error)" : "var(--text-muted)",
        }}
      >
        {/* Expand indicator for steps with details */}
        {hasDetails ? (
          <ChevronRight
            className={`w-3 h-3 flex-shrink-0 mt-0.5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
            style={{ color: "var(--text-muted)" }}
          />
        ) : (
          <div className="w-3 flex-shrink-0" />
        )}

        {/* Step status indicator */}
        <div className="flex items-center gap-1.5 min-w-0 flex-shrink-0">
          {isStepActive ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--accent-secondary)" }} />
          ) : isStepFailed ? (
            <XCircle className="w-3.5 h-3.5" />
          ) : (
            <CheckCircle className="w-3.5 h-3.5" style={{ color: "var(--success, #22c55e)", opacity: 0.7 }} />
          )}
        </div>

        {/* Step content */}
        <span className="min-w-0 flex-1 text-left truncate">{step.content}</span>

        {/* Duration */}
        {stepDuration && (
          <span
            className="text-xs flex-shrink-0 tabular-nums"
            style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
          >
            {stepDuration}
          </span>
        )}
      </button>

      {/* Expanded details */}
      {isExpanded && hasDetails && (
        <div
          className="ml-5 mt-1 mb-2 rounded-lg overflow-hidden border"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-tertiary)" }}
        >
          {/* Tool input */}
          {step.tool_input && Object.keys(step.tool_input).length > 0 && (
            <div className="p-2 border-b" style={{ borderColor: "var(--border-subtle)" }}>
              <div className="text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                Input
              </div>
              <pre className="text-xs overflow-x-auto font-mono" style={{ color: "var(--text-primary)" }}>
                {JSON.stringify(step.tool_input, null, 2)}
              </pre>
            </div>
          )}

          {/* Tool result */}
          {step.tool_result && (
            <div className="p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                  Result
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleCopy}
                    className="p-1 rounded hover:bg-[var(--hover-overlay)] transition-colors"
                    title="Copy result"
                  >
                    {copied ? (
                      <Check className="w-3 h-3" style={{ color: "var(--success)" }} />
                    ) : (
                      <Copy className="w-3 h-3" style={{ color: "var(--text-muted)" }} />
                    )}
                  </button>
                  <button
                    onClick={handleExpand}
                    className="p-1 rounded hover:bg-[var(--hover-overlay)] transition-colors"
                    title="Open in panel"
                  >
                    <Maximize2 className="w-3 h-3" style={{ color: "var(--text-muted)" }} />
                  </button>
                </div>
              </div>
              <ToolResultPreview content={step.tool_result} toolName={step.tool_name} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Renders tool result with nice formatting
 */
function ToolResultPreview({ content, toolName }: { content: string; toolName?: string }) {
  const { navigateToEvent } = useToolResultPanel()
  const isSearchResult = toolName === "search_messages" || toolName === "search_memos" || toolName === "web_search"
  const maxPreviewLength = 800

  // Truncate if too long
  const truncated = content.length > maxPreviewLength
  const displayContent = truncated ? content.slice(0, maxPreviewLength) : content

  if (isSearchResult) {
    // Parse search results - they're separated by "---"
    const sections = displayContent
      .split(/\n*---\n*/)
      .filter(Boolean)
      .slice(0, 3) // Show max 3 results

    return (
      <div className="space-y-2">
        {sections.map((section, idx) => {
          // Try to parse new format: [N|eventId|streamId] Author in #channel (date):\nContent
          // Or fallback to old format: [N] Author in #channel (date):\nContent
          const newFormatMatch = section.match(/^\[(\d+)\|([^|]+)\|([^\]]+)\]\s*(.+?):\n([\s\S]*)$/)
          const oldFormatMatch = !newFormatMatch && section.match(/^\[(\d+)\]\s*(.+?):\n([\s\S]*)$/)

          if (newFormatMatch) {
            const [, num, eventId, streamId, header, body] = newFormatMatch
            const canNavigate = !!navigateToEvent && eventId && streamId

            return (
              <div
                key={idx}
                className={`p-2 rounded text-xs ${canNavigate ? "cursor-pointer hover:ring-1 hover:ring-[var(--accent-primary)] transition-all" : ""}`}
                style={{ background: "var(--bg-secondary)" }}
                onClick={canNavigate ? () => navigateToEvent(streamId, eventId) : undefined}
                title={canNavigate ? "Click to view message" : undefined}
              >
                <div className="font-medium mb-1 flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                  <span>
                    [{num}] {header}
                  </span>
                  {canNavigate && <ExternalLink className="w-3 h-3 opacity-50" />}
                </div>
                <div style={{ color: "var(--text-primary)" }}>
                  {body.trim().slice(0, 200)}
                  {body.trim().length > 200 ? "..." : ""}
                </div>
              </div>
            )
          }

          if (oldFormatMatch) {
            const [, num, header, body] = oldFormatMatch
            return (
              <div key={idx} className="p-2 rounded text-xs" style={{ background: "var(--bg-secondary)" }}>
                <div className="font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                  [{num}] {header}
                </div>
                <div style={{ color: "var(--text-primary)" }}>
                  {body.trim().slice(0, 200)}
                  {body.trim().length > 200 ? "..." : ""}
                </div>
              </div>
            )
          }

          return (
            <div
              key={idx}
              className="p-2 rounded text-xs"
              style={{ background: "var(--bg-secondary)", color: "var(--text-primary)" }}
            >
              {section.slice(0, 200)}
              {section.length > 200 ? "..." : ""}
            </div>
          )
        })}
        {(truncated || displayContent.split(/\n*---\n*/).filter(Boolean).length > 3) && (
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            + more results...
          </div>
        )}
      </div>
    )
  }

  // Default: show as preformatted text
  return (
    <pre
      className="text-xs whitespace-pre-wrap font-mono max-h-48 overflow-y-auto"
      style={{ color: "var(--text-primary)" }}
    >
      {displayContent}
      {truncated && <span style={{ color: "var(--text-muted)" }}>...</span>}
    </pre>
  )
}

/**
 * Displays an agent thinking session inline in the chat.
 *
 * Shows as a collapsible thin event with:
 * - Header showing status and duration
 * - Summary when collapsed (after completion)
 * - Full step timeline when expanded with expandable details per step
 * - Subtle connector line to response below
 */
export function AgentThinkingEvent({ session, isLinkedToResponse = false, className = "" }: AgentThinkingEventProps) {
  const [isExpanded, setIsExpanded] = useState(session.status === "active")

  const isDone = session.status === "completed" || session.status === "failed"
  const isActive = session.status === "active" || session.status === "summarizing"
  const duration = formatDuration(session.startedAt, session.completedAt)

  // Get the latest active step for status display
  const activeStep = session.steps.find((s) => s.status === "active")

  // Count steps with tool results
  const stepsWithResults = session.steps.filter((s) => s.type === "tool_call" && s.tool_result).length

  return (
    <div className={`relative ${className}`}>
      {/* Main thinking event container */}
      <div
        className="group mb-1 rounded-lg -mx-2 overflow-hidden transition-all"
        style={{
          background: isActive ? "var(--bg-tertiary)" : "transparent",
          borderLeft: "3px solid var(--accent-secondary, #8b5cf6)",
        }}
      >
        {/* Header - always visible */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-[var(--hover-overlay)] transition-colors"
        >
          {/* Ariadne avatar */}
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
            style={{
              background:
                "linear-gradient(135deg, var(--accent-secondary, #8b5cf6) 0%, var(--accent-primary, #3b82f6) 100%)",
            }}
          >
            <Sparkles className="w-3 h-3 text-white" />
          </div>

          <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            Ariadne
          </span>

          {/* Status indicator */}
          {isActive ? (
            <span
              className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1.5"
              style={{
                background: "var(--accent-secondary-muted, rgba(139, 92, 246, 0.15))",
                color: "var(--accent-secondary, #8b5cf6)",
              }}
            >
              <Loader2 className="w-3 h-3 animate-spin" />
              {activeStep ? stepLabels[activeStep.type] : "Thinking"}
            </span>
          ) : session.status === "failed" ? (
            <span
              className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
              style={{
                background: "var(--error-muted, rgba(239, 68, 68, 0.15))",
                color: "var(--error, #ef4444)",
              }}
            >
              <XCircle className="w-3 h-3" />
              Failed
            </span>
          ) : (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              thought for {duration}
              {stepsWithResults > 0 && ` · ${stepsWithResults} tool${stepsWithResults > 1 ? "s" : ""} used`}
            </span>
          )}

          {/* Expand/collapse */}
          <div className="ml-auto flex items-center gap-2">
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
            ) : (
              <ChevronDown className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
            )}
          </div>
        </button>

        {/* Summary - shown when collapsed and completed */}
        {!isExpanded && isDone && session.summary && (
          <div className="px-3 pb-2 pl-10">
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {session.summary}
            </p>
          </div>
        )}

        {/* Expanded content - step timeline */}
        {isExpanded && (
          <div
            className="px-3 pb-3 pl-8 border-t"
            style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}
          >
            <div className="pt-2 space-y-0.5">
              {session.steps.map((step) => (
                <StepItem key={step.id} step={step} />
              ))}

              {/* Error message */}
              {session.status === "failed" && session.errorMessage && (
                <div className="mt-2 text-sm" style={{ color: "var(--error)" }}>
                  Error: {session.errorMessage}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Connector line to response below */}
      {isLinkedToResponse && isDone && session.responseEventId && (
        <div
          className="absolute left-3 top-full w-0.5 h-3"
          style={{ background: "var(--accent-secondary, #8b5cf6)", opacity: 0.3 }}
        />
      )}
    </div>
  )
}

/**
 * Mini badge version for inline display.
 */
export function AgentThinkingBadge({ session }: { session: AgentSession }) {
  const isActive = session.status === "active" || session.status === "summarizing"
  const activeStep = session.steps.find((s) => s.status === "active")

  if (session.status === "completed") return null

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs"
      style={{
        background:
          session.status === "failed"
            ? "var(--error-muted, rgba(239, 68, 68, 0.15))"
            : "var(--accent-secondary-muted, rgba(139, 92, 246, 0.15))",
        color: session.status === "failed" ? "var(--error, #ef4444)" : "var(--accent-secondary, #8b5cf6)",
      }}
    >
      {isActive ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
      {session.status === "failed" ? "Failed" : activeStep ? stepLabels[activeStep.type] : "Thinking..."}
    </span>
  )
}
