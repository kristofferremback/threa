import { useState } from "react"
import { Sparkles, ChevronDown, ChevronUp, Brain, Wrench, FileText, CheckCircle, XCircle, Loader2 } from "lucide-react"

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
 * Displays an agent thinking session inline in the chat.
 *
 * Shows as a collapsible thin event with:
 * - Header showing status and duration
 * - Summary when collapsed (after completion)
 * - Full step timeline when expanded
 * - Subtle connector line to response below
 */
export function AgentThinkingEvent({ session, isLinkedToResponse = false, className = "" }: AgentThinkingEventProps) {
  const [isExpanded, setIsExpanded] = useState(session.status === "active")

  const isDone = session.status === "completed" || session.status === "failed"
  const isActive = session.status === "active" || session.status === "summarizing"
  const duration = formatDuration(session.startedAt, session.completedAt)

  // Get the latest active step for status display
  const activeStep = session.steps.find((s) => s.status === "active")

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
            className="px-3 pb-3 pl-10 border-t"
            style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}
          >
            <div className="pt-2 space-y-1.5">
              {session.steps.map((step, idx) => {
                const Icon = stepIcons[step.type]
                const isStepActive = step.status === "active"
                const isStepFailed = step.status === "failed"
                const stepDuration = formatStepDuration(step)

                return (
                  <div
                    key={step.id}
                    className="flex items-start gap-2 text-sm"
                    style={{
                      color: isStepActive
                        ? "var(--text-primary)"
                        : isStepFailed
                          ? "var(--error)"
                          : "var(--text-muted)",
                    }}
                  >
                    {/* Step indicator */}
                    <div className="flex items-center gap-1.5 min-w-0 flex-shrink-0">
                      {isStepActive ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--accent-secondary)" }} />
                      ) : isStepFailed ? (
                        <XCircle className="w-3.5 h-3.5" />
                      ) : (
                        <CheckCircle
                          className="w-3.5 h-3.5"
                          style={{ color: "var(--success, #22c55e)", opacity: 0.7 }}
                        />
                      )}
                    </div>

                    {/* Step content */}
                    <span className="min-w-0 flex-1 truncate">{step.content}</span>

                    {/* Duration */}
                    {stepDuration && (
                      <span
                        className="text-xs flex-shrink-0 tabular-nums"
                        style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
                      >
                        {stepDuration}
                      </span>
                    )}
                  </div>
                )
              })}

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
