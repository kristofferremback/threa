import { useRef, useEffect } from "react"
import type { AgentSessionStep } from "@threa/types"
import { TraceStep } from "./trace-step"
import { cn } from "@/lib/utils"

interface TraceStepListProps {
  steps: AgentSessionStep[]
  highlightMessageId: string | null
  workspaceId: string
  streamId: string
}

export function TraceStepList({ steps, highlightMessageId, workspaceId, streamId }: TraceStepListProps) {
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
        return (
          <div
            key={step.id}
            ref={isHighlighted ? highlightRef : undefined}
            className={cn(isHighlighted && "ring-2 ring-primary/20 ring-inset")}
          >
            <TraceStep step={step} workspaceId={workspaceId} streamId={streamId} />
          </div>
        )
      })}
    </div>
  )
}
