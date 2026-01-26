import { useParams } from "react-router-dom"
import { Dialog, DialogContent, DialogClose, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { RelativeTime } from "@/components/relative-time"
import { useTrace } from "@/contexts"
import { useAgentTrace } from "@/hooks/use-agent-trace"
import { TraceStepList } from "./trace-step-list"
import { X } from "lucide-react"
import type { AgentSessionStatus } from "@threa/types"

const STATUS_TEXT: Record<AgentSessionStatus, string> = {
  pending: "Session pending",
  running: "Session running",
  completed: "Session completed",
  failed: "Session failed",
}

export function TraceDialog() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { sessionId, highlightMessageId, closeTraceModal } = useTrace()

  const { steps, session, persona, status, isLoading, error } = useAgentTrace(workspaceId!, sessionId!)

  if (!sessionId) return null

  const sessionDuration = session?.completedAt
    ? formatDuration(new Date(session.completedAt).getTime() - new Date(session.createdAt).getTime())
    : null

  const messageCount = steps.filter((s) => s.stepType === "message_sent").length

  return (
    <Dialog open onOpenChange={(open) => !open && closeTraceModal()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0 [&>button:last-child]:hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b shrink-0 flex items-center justify-between">
          <div>
            <DialogTitle className="text-lg font-semibold">
              {isLoading ? <Skeleton className="h-5 w-48" /> : "Agent Session Trace"}
            </DialogTitle>
            {session && persona && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                <span>{persona.name}</span>
                <span>•</span>
                <RelativeTime date={session.createdAt} className="text-xs text-muted-foreground" />
                {sessionDuration && (
                  <>
                    <span>•</span>
                    <span>{sessionDuration}</span>
                  </>
                )}
              </div>
            )}
          </div>
          <DialogClose className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </div>

        {/* Steps */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {isLoading ? (
            <div className="p-6 space-y-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : error ? (
            <div className="p-6 text-center text-destructive">Failed to load trace. Please try again.</div>
          ) : (
            <TraceStepList
              steps={steps}
              highlightMessageId={highlightMessageId}
              workspaceId={workspaceId!}
              streamId={session?.streamId ?? ""}
            />
          )}
        </div>

        {/* Bottom bar */}
        {status && (
          <div className="px-6 py-4 border-t shrink-0 flex items-center justify-between text-xs text-muted-foreground">
            <span>{STATUS_TEXT[status]}</span>
            <span>
              {steps.length} {steps.length === 1 ? "step" : "steps"} • {messageCount}{" "}
              {messageCount === 1 ? "message" : "messages"} sent
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms"
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}m ${remainingSeconds}s`
}
