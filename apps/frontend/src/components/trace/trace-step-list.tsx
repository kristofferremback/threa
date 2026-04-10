import { useRef, useEffect } from "react"
import type { AgentSessionStep, AgentStepType } from "@threa/types"
import type { StreamingSubstep } from "@/hooks/use-agent-trace"
import { TraceStep } from "./trace-step"
import { cn } from "@/lib/utils"

interface TraceStepListProps {
  steps: AgentSessionStep[]
  highlightMessageId: string | null
  workspaceId: string
  streamId: string
  /**
   * Live substep history keyed by step type. Used by the trace dialog to render
   * an in-flight step's phase timeline before its content is persisted. Cleared
   * by `useAgentTrace` on `agent_session:step:completed`.
   */
  streamingSubsteps?: Partial<Record<AgentStepType, StreamingSubstep[]>>
}

export function TraceStepList({
  steps,
  highlightMessageId,
  workspaceId,
  streamId,
  streamingSubsteps,
}: TraceStepListProps) {
  const highlightRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (highlightMessageId && highlightRef.current) {
      setTimeout(() => {
        highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
      }, 100)
    }
  }, [highlightMessageId, steps])

  if (steps.length === 0) {
    return <div className="p-6 text-center text-muted-foreground">No steps recorded yet.</div>
  }

  return (
    <div>
      {steps.map((step) => {
        const isHighlighted = step.messageId === highlightMessageId
        const liveSubsteps = streamingSubsteps?.[step.stepType]
        return (
          <div
            key={step.id}
            ref={isHighlighted ? highlightRef : undefined}
            className={cn(isHighlighted && "ring-2 ring-primary/20 ring-inset")}
          >
            <TraceStep step={step} workspaceId={workspaceId} streamId={streamId} liveSubsteps={liveSubsteps} />
          </div>
        )
      })}
    </div>
  )
}
