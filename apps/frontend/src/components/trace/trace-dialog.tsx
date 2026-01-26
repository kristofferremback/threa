import { useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Dialog, DialogContent, DialogClose, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { useTrace } from "@/contexts"
import { agentSessionsApi } from "@/api"
import { TraceStepList } from "./trace-step-list"
import { Settings, X } from "lucide-react"
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

  const { data, isLoading, error } = useQuery({
    queryKey: ["agent-session", workspaceId, sessionId],
    queryFn: () => agentSessionsApi.getSession(workspaceId!, sessionId!),
    enabled: !!workspaceId && !!sessionId,
  })

  if (!sessionId) return null

  const sessionDuration = data?.session.completedAt
    ? formatDuration(new Date(data.session.completedAt).getTime() - new Date(data.session.createdAt).getTime())
    : null

  const sessionTime = data
    ? new Date(data.session.createdAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : null

  const messageCount = data?.session.sentMessageIds.length ?? 0

  return (
    <Dialog open onOpenChange={(open) => !open && closeTraceModal()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0 [&>button:last-child]:hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b shrink-0 flex items-center justify-between">
          <div>
            <DialogTitle className="text-lg font-semibold">
              {isLoading ? <Skeleton className="h-5 w-48" /> : "Agent Session Trace"}
            </DialogTitle>
            {data && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                <span>{data.persona.name}</span>
                <span>•</span>
                <span>{sessionTime}</span>
                {sessionDuration && (
                  <>
                    <span>•</span>
                    <span>{sessionDuration}</span>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Trace preferences"
            >
              <Settings className="w-4 h-4" />
            </button>
            <DialogClose className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              <X className="w-5 h-5" />
              <span className="sr-only">Close</span>
            </DialogClose>
          </div>
        </div>

        {/* Steps */}
        <ScrollArea className="flex-1 min-h-0">
          {isLoading ? (
            <div className="p-6 space-y-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : error ? (
            <div className="p-6 text-center text-destructive">Failed to load trace. Please try again.</div>
          ) : data ? (
            <TraceStepList
              steps={data.steps}
              highlightMessageId={highlightMessageId}
              workspaceId={workspaceId!}
              streamId={data.session.streamId}
            />
          ) : null}
        </ScrollArea>

        {/* Bottom bar */}
        {data && (
          <div className="px-6 py-4 border-t shrink-0 flex items-center justify-between text-xs text-muted-foreground">
            <span>{STATUS_TEXT[data.session.status]}</span>
            <span>
              {data.steps.length} {data.steps.length === 1 ? "step" : "steps"} • {messageCount}{" "}
              {messageCount === 1 ? "message" : "messages"} sent
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}m ${remainingSeconds}s`
}
