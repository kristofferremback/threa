import { Sparkles, Search, Brain, Wrench, CheckCircle, XCircle } from "lucide-react"
import type { AriadneThinkingState, AriadneThinkingStep } from "../../hooks/useAriadneThinking"

interface AriadneThinkingIndicatorProps {
  state: AriadneThinkingState
  className?: string
}

const stepIcons: Record<AriadneThinkingStep["stepType"], typeof Brain> = {
  reasoning: Brain,
  searching: Search,
  analyzing: Sparkles,
  tool_call: Wrench,
}

const stepLabels: Record<AriadneThinkingStep["stepType"], string> = {
  reasoning: "Thinking",
  searching: "Searching",
  analyzing: "Analyzing",
  tool_call: "Using tool",
}

/**
 * Displays Ariadne's thinking state as an inline indicator.
 *
 * Shows the current thinking step with an animated indicator.
 * Other messages can appear around this - it doesn't block the message list.
 */
export function AriadneThinkingIndicator({ state, className = "" }: AriadneThinkingIndicatorProps) {
  const isDone = state.status === "done"
  const latestStep = state.steps[state.steps.length - 1]
  const StepIcon = latestStep ? stepIcons[latestStep.stepType] : Sparkles

  return (
    <div
      className={`group mb-1 rounded-lg p-3 -mx-2 animate-fade-in ${className}`}
      style={{
        background: isDone ? "transparent" : "var(--bg-tertiary)",
        borderLeft: "3px solid var(--accent-secondary, #8b5cf6)",
      }}
    >
      <div className="flex items-center gap-2">
        {/* Ariadne avatar */}
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
          style={{
            background:
              "linear-gradient(135deg, var(--accent-secondary, #8b5cf6) 0%, var(--accent-primary, #3b82f6) 100%)",
          }}
        >
          <Sparkles className="w-3.5 h-3.5 text-white" />
        </div>

        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          Ariadne
        </span>

        {/* Status badge */}
        {isDone ? (
          <span
            className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
            style={{
              background: state.success
                ? "var(--success-muted, rgba(34, 197, 94, 0.15))"
                : "var(--error-muted, rgba(239, 68, 68, 0.15))",
              color: state.success ? "var(--success, #22c55e)" : "var(--error, #ef4444)",
            }}
          >
            {state.success ? (
              <>
                <CheckCircle className="w-3 h-3" />
                Done
              </>
            ) : (
              <>
                <XCircle className="w-3 h-3" />
                Failed
              </>
            )}
          </span>
        ) : (
          <span
            className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
            style={{
              background: "var(--accent-secondary-muted, rgba(139, 92, 246, 0.15))",
              color: "var(--accent-secondary, #8b5cf6)",
            }}
          >
            <span className="relative flex h-2 w-2">
              <span
                className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ background: "var(--accent-secondary, #8b5cf6)" }}
              />
              <span
                className="relative inline-flex rounded-full h-2 w-2"
                style={{ background: "var(--accent-secondary, #8b5cf6)" }}
              />
            </span>
            Thinking
          </span>
        )}
      </div>

      {/* Thinking steps */}
      <div className="pl-8 mt-2">
        {state.steps.length === 0 && !isDone ? (
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
            <div className="flex gap-1">
              <span className="animate-bounce" style={{ animationDelay: "0ms" }}>
                .
              </span>
              <span className="animate-bounce" style={{ animationDelay: "150ms" }}>
                .
              </span>
              <span className="animate-bounce" style={{ animationDelay: "300ms" }}>
                .
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {state.steps.map((step, idx) => {
              const Icon = stepIcons[step.stepType]
              const isLatest = idx === state.steps.length - 1 && !isDone

              return (
                <div
                  key={`${step.stepType}-${step.timestamp}`}
                  className="flex items-start gap-2 text-sm"
                  style={{
                    color: isLatest ? "var(--text-secondary)" : "var(--text-muted)",
                    opacity: isLatest ? 1 : 0.7,
                  }}
                >
                  <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${isLatest ? "animate-pulse" : ""}`} />
                  <span className="min-w-0 break-words">{step.content}</span>
                </div>
              )
            })}
          </div>
        )}

        {/* Error message */}
        {isDone && !state.success && state.errorMessage && (
          <div className="mt-2 text-sm" style={{ color: "var(--error, #ef4444)" }}>
            {state.errorMessage}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Compact version for inline display within messages.
 */
export function AriadneThinkingBadge({ state }: { state: AriadneThinkingState }) {
  const isDone = state.status === "done"
  const latestStep = state.steps[state.steps.length - 1]

  if (isDone && state.success) return null // Don't show badge after success

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs"
      style={{
        background:
          isDone && !state.success
            ? "var(--error-muted, rgba(239, 68, 68, 0.15))"
            : "var(--accent-secondary-muted, rgba(139, 92, 246, 0.15))",
        color: isDone && !state.success ? "var(--error, #ef4444)" : "var(--accent-secondary, #8b5cf6)",
      }}
    >
      <Sparkles className="w-3 h-3" />
      {isDone && !state.success ? (
        "Ariadne failed"
      ) : latestStep ? (
        <>
          {stepLabels[latestStep.stepType]}
          <span className="animate-pulse">...</span>
        </>
      ) : (
        <>
          Ariadne is thinking
          <span className="animate-pulse">...</span>
        </>
      )}
    </span>
  )
}
