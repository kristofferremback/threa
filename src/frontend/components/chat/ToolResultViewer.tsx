import { useState, useRef, useEffect, createContext, useContext } from "react"
import { X, Maximize2, Copy, Check, ExternalLink } from "lucide-react"
import type { SessionStep } from "./AgentThinkingEvent"

// Callback for navigating to a stream/event
export type NavigateToEventFn = (streamId: string, eventId: string) => void

// Context for managing the expanded panel state and navigation
interface ToolResultPanelState {
  expandedStep: SessionStep | null
  setExpandedStep: (step: SessionStep | null) => void
  navigateToEvent: NavigateToEventFn | null
}

const ToolResultPanelContext = createContext<ToolResultPanelState | null>(null)

interface ToolResultPanelProviderProps {
  children: React.ReactNode
  onNavigateToEvent?: NavigateToEventFn
}

export function ToolResultPanelProvider({ children, onNavigateToEvent }: ToolResultPanelProviderProps) {
  const [expandedStep, setExpandedStep] = useState<SessionStep | null>(null)

  return (
    <ToolResultPanelContext.Provider
      value={{ expandedStep, setExpandedStep, navigateToEvent: onNavigateToEvent || null }}
    >
      {children}
    </ToolResultPanelContext.Provider>
  )
}

export function useToolResultPanel() {
  const context = useContext(ToolResultPanelContext)
  if (!context) {
    return { expandedStep: null, setExpandedStep: () => {}, navigateToEvent: null }
  }
  return context
}

interface ToolResultPeekProps {
  step: SessionStep
  children: React.ReactNode
}

/**
 * Wraps a step element to add hover preview functionality.
 * Shows a preview popup on hover for tool steps with results.
 */
export function ToolResultPeek({ step, children }: ToolResultPeekProps) {
  const [isHovering, setIsHovering] = useState(false)
  const [showPeek, setShowPeek] = useState(false)
  const peekRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const { setExpandedStep } = useToolResultPanel()

  const hasResult = step.type === "tool_call" && step.tool_result && step.status === "completed"

  // Delay showing peek to avoid flickering on quick hovers
  useEffect(() => {
    if (isHovering && hasResult) {
      const timer = setTimeout(() => setShowPeek(true), 300)
      return () => clearTimeout(timer)
    } else {
      setShowPeek(false)
    }
  }, [isHovering, hasResult])

  if (!hasResult) {
    return <>{children}</>
  }

  const truncatedResult = step.tool_result!.length > 500 ? step.tool_result!.slice(0, 500) + "..." : step.tool_result!

  return (
    <div
      ref={triggerRef}
      className="relative"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* Original content with visual indicator */}
      <div className="cursor-pointer group/peek" onClick={() => setExpandedStep(step)}>
        {children}
        {/* Small indicator that result is viewable */}
        <span
          className="ml-2 opacity-0 group-hover/peek:opacity-100 transition-opacity text-xs"
          style={{ color: "var(--accent-secondary)" }}
        >
          View
        </span>
      </div>

      {/* Hover peek preview */}
      {showPeek && (
        <div
          ref={peekRef}
          className="absolute left-full ml-2 top-0 z-50 w-80 max-h-64 overflow-hidden rounded-lg shadow-lg animate-fade-in"
          style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-default)",
          }}
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
        >
          {/* Header */}
          <div
            className="px-3 py-2 flex items-center justify-between border-b"
            style={{ borderColor: "var(--border-subtle)", background: "var(--bg-tertiary)" }}
          >
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              {step.tool_name || "Tool Result"}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setExpandedStep(step)
              }}
              className="p-1 rounded hover:bg-[var(--hover-overlay)] transition-colors"
              title="Expand to panel"
            >
              <Maximize2 className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
            </button>
          </div>

          {/* Preview content */}
          <div className="p-3 overflow-y-auto max-h-48">
            <pre className="text-xs whitespace-pre-wrap font-mono" style={{ color: "var(--text-primary)" }}>
              {truncatedResult}
            </pre>
          </div>

          {/* Footer with expand hint */}
          {step.tool_result!.length > 500 && (
            <div
              className="px-3 py-2 text-xs border-t"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
            >
              Click to view full result
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Slide-out panel for viewing full tool results.
 * Should be rendered near the root of the app.
 */
export function ToolResultPanel() {
  const { expandedStep, setExpandedStep } = useToolResultPanel()
  const [copied, setCopied] = useState(false)

  if (!expandedStep || !expandedStep.tool_result) {
    return null
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(expandedStep.tool_result!)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Parse tool result to detect if it contains formatted search results
  const isSearchResult =
    expandedStep.tool_name === "search_messages" ||
    expandedStep.tool_name === "search_memos" ||
    expandedStep.tool_name === "web_search"

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30 animate-fade-in" onClick={() => setExpandedStep(null)} />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 w-[480px] max-w-[90vw] flex flex-col animate-slide-in-right shadow-2xl"
        style={{ background: "var(--bg-primary)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}
        >
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {expandedStep.tool_name || "Tool Result"}
            </h2>
            {expandedStep.status === "completed" && (
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  background: "var(--success-muted, rgba(34, 197, 94, 0.15))",
                  color: "var(--success, #22c55e)",
                }}
              >
                Completed
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopy}
              className="p-2 rounded hover:bg-[var(--hover-overlay)] transition-colors"
              title="Copy result"
            >
              {copied ? (
                <Check className="w-4 h-4" style={{ color: "var(--success)" }} />
              ) : (
                <Copy className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
              )}
            </button>
            <button
              onClick={() => setExpandedStep(null)}
              className="p-2 rounded hover:bg-[var(--hover-overlay)] transition-colors"
              title="Close"
            >
              <X className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
            </button>
          </div>
        </div>

        {/* Tool Input section */}
        {expandedStep.tool_input && Object.keys(expandedStep.tool_input).length > 0 && (
          <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border-subtle)" }}>
            <h3 className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>
              Input
            </h3>
            <pre
              className="text-xs p-2 rounded overflow-x-auto font-mono"
              style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
            >
              {JSON.stringify(expandedStep.tool_input, null, 2)}
            </pre>
          </div>
        )}

        {/* Result content */}
        <div className="flex-1 overflow-y-auto p-4">
          <h3 className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>
            Result
          </h3>
          {isSearchResult ? (
            <SearchResultsView content={expandedStep.tool_result!} />
          ) : (
            <pre
              className="text-sm whitespace-pre-wrap font-mono p-3 rounded"
              style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
            >
              {expandedStep.tool_result}
            </pre>
          )}
        </div>
      </div>
    </>
  )
}

/**
 * Renders search results in a nicer format with clickable navigation
 */
function SearchResultsView({ content }: { content: string }) {
  const { navigateToEvent, setExpandedStep } = useToolResultPanel()
  // Try to parse the content into individual results
  // Results are typically separated by "---"
  const sections = content.split(/\n*---\n*/).filter(Boolean)

  const handleNavigate = (streamId: string, eventId: string) => {
    if (navigateToEvent) {
      navigateToEvent(streamId, eventId)
      setExpandedStep(null) // Close the panel
    }
  }

  return (
    <div className="space-y-3">
      {sections.map((section, idx) => {
        // Try to parse new format: [N|eventId|streamId] Author in #channel (date):\nContent
        const newFormatMatch = section.match(/^\[(\d+)\|([^|]+)\|([^\]]+)\]\s*(.+?):\n([\s\S]*)$/)
        // Fallback to old format: [N] Author in #channel (date):\nContent
        const oldFormatMatch = !newFormatMatch && section.match(/^\[(\d+)\]\s*(.+?):\n([\s\S]*)$/)

        if (newFormatMatch) {
          const [, _num, eventId, streamId, header, body] = newFormatMatch
          const canNavigate = !!navigateToEvent && eventId && streamId

          return (
            <div
              key={idx}
              className={`p-3 rounded-lg border ${canNavigate ? "cursor-pointer hover:border-[var(--accent-primary)] transition-colors" : ""}`}
              style={{
                background: "var(--bg-tertiary)",
                borderColor: "var(--border-subtle)",
              }}
              onClick={canNavigate ? () => handleNavigate(streamId, eventId) : undefined}
            >
              <div
                className="text-xs font-medium mb-2 flex items-center gap-2"
                style={{ color: "var(--text-secondary)" }}
              >
                <span>{header}</span>
                {canNavigate && <ExternalLink className="w-3.5 h-3.5 opacity-50" />}
              </div>
              <div className="text-sm" style={{ color: "var(--text-primary)" }}>
                {body.trim()}
              </div>
            </div>
          )
        }

        if (oldFormatMatch) {
          const [, _num, header, body] = oldFormatMatch
          return (
            <div
              key={idx}
              className="p-3 rounded-lg border"
              style={{
                background: "var(--bg-tertiary)",
                borderColor: "var(--border-subtle)",
              }}
            >
              <div className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>
                {header}
              </div>
              <div className="text-sm" style={{ color: "var(--text-primary)" }}>
                {body.trim()}
              </div>
            </div>
          )
        }

        // Fallback: render as-is
        return (
          <div
            key={idx}
            className="p-3 rounded-lg text-sm"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)" }}
          >
            {section}
          </div>
        )
      })}
    </div>
  )
}
