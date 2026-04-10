import { useRef, useEffect } from "react"
import { AgentStepTypes, type AgentSessionStep, type AgentStepType } from "@threa/types"
import type { StreamingSubstep } from "@/hooks/use-agent-trace"
import { TraceStep, InFlightStepCard } from "./trace-step"
import { cn } from "@/lib/utils"

/**
 * Step types that can produce live substeps in the trace dialog. When live
 * substeps arrive for one of these types AND there's no persisted step row yet,
 * `TraceStepList` renders an `InFlightStepCard` for it so the dialog mirrors
 * the streaming feedback the timeline card already shows.
 *
 * V1: only `workspace_search`. Extend when other tools start emitting substeps.
 */
const IN_FLIGHT_STEP_TYPES: AgentStepType[] = [AgentStepTypes.WORKSPACE_SEARCH]

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
  /**
   * Callback to gracefully abort an in-flight tool call (e.g. workspace research).
   * When provided, the in-flight step card renders a Stop research button in its
   * header so the user can interrupt from inside the trace dialog, not just the
   * timeline card.
   */
  onAbortResearch?: () => void
}

export function TraceStepList({
  steps,
  highlightMessageId,
  workspaceId,
  streamId,
  streamingSubsteps,
  onAbortResearch,
}: TraceStepListProps) {
  const highlightRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (highlightMessageId && highlightRef.current) {
      setTimeout(() => {
        highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
      }, 100)
    }
  }, [highlightMessageId, steps])

  // Compute which step types currently have streaming substeps that should be
  // rendered as an in-flight pseudo-step at the end of the list. We only render
  // an in-flight card for a step type when there are actual substep entries —
  // empty arrays (a freshly initialised key) don't produce a card.
  const inFlightEntries: Array<{ stepType: AgentStepType; substeps: StreamingSubstep[] }> = []
  if (streamingSubsteps) {
    for (const stepType of IN_FLIGHT_STEP_TYPES) {
      const substeps = streamingSubsteps[stepType]
      if (substeps && substeps.length > 0) {
        inFlightEntries.push({ stepType, substeps })
      }
    }
  }

  if (steps.length === 0 && inFlightEntries.length === 0) {
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
      {inFlightEntries.map(({ stepType, substeps }) => (
        <InFlightStepCard
          key={`in-flight-${stepType}`}
          stepType={stepType}
          substeps={substeps}
          onAbort={onAbortResearch}
        />
      ))}
    </div>
  )
}
