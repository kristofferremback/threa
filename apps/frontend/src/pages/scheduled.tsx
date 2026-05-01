import { useCallback } from "react"
import { useParams, Link } from "react-router-dom"
import { ArrowLeft, Clock } from "lucide-react"
import { toast } from "sonner"
import { buttonVariants } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { useScheduledList, useCancelScheduled, useUpdateScheduled, usePauseScheduled, useResumeScheduled } from "@/hooks/use-scheduled"
import { SidebarToggle } from "@/components/layout"
import { ScheduledItem } from "@/components/scheduled/scheduled-item"
import { ScheduledEmpty } from "@/components/scheduled/scheduled-empty"
import { ScheduledSkeleton } from "@/components/scheduled/scheduled-skeleton"

export function ScheduledPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()

  if (!workspaceId) return null

  return <ScheduledPageInner workspaceId={workspaceId} />
}

function ScheduledPageInner({ workspaceId }: { workspaceId: string }) {
  const items = useScheduledList(workspaceId)
  const cancelMutation = useCancelScheduled(workspaceId)
  const updateMutation = useUpdateScheduled(workspaceId)
  const pauseMutation = usePauseScheduled(workspaceId)
  const resumeMutation = useResumeScheduled(workspaceId)

  const handleCancel = useCallback(
    (scheduledId: string) => {
      cancelMutation.mutate(scheduledId, {
        onSuccess: () => toast.success("Scheduled message cancelled"),
        onError: () => toast.error("Could not cancel scheduled message"),
      })
    },
    [cancelMutation]
  )

  const handleSendNow = useCallback(
    (scheduledId: string) => {
      updateMutation.mutate(
        { id: scheduledId, input: { scheduledAt: new Date().toISOString() } },
        {
          onSuccess: () => toast.success("Message sent"),
          onError: () => toast.error("Could not send message"),
        }
      )
    },
    [updateMutation]
  )

  const handlePause = useCallback(
    (scheduledId: string) => {
      pauseMutation.mutate(scheduledId, {
        onSuccess: () => toast.success("Message paused"),
        onError: () => toast.error("Could not pause message"),
      })
    },
    [pauseMutation]
  )

  const handleResume = useCallback(
    (scheduledId: string) => {
      resumeMutation.mutate(scheduledId, {
        onSuccess: () => toast.success("Message resumed"),
        onError: () => toast.error("Could not resume message"),
      })
    },
    [resumeMutation]
  )

  const handleEdit = useCallback(
    (scheduledId: string) => {
      // Edit opens the scheduled message in the composer — navigates to the
      // target stream with an edit trigger. For now, this opens the drawer.
      // The full edit flow (Stage 5) wires this through the composer.
      toast.info("Edit in composer coming soon")
    },
    []
  )

  let content = <ScheduledSkeleton />
  if (items !== undefined) {
    if (items.length === 0) {
      content = <ScheduledEmpty />
    } else {
      // Sort: pending first by scheduledAt, then paused, then sent/cancelled
      const sorted = [...items].sort((a, b) => {
        const aIsActive = !a.sentAt && !a.cancelledAt && !a.pausedAt
        const bIsActive = !b.sentAt && !b.cancelledAt && !b.pausedAt
        if (aIsActive && !bIsActive) return -1
        if (!aIsActive && bIsActive) return 1
        return a._scheduledAtMs - b._scheduledAtMs
      })

      content = (
        <div className="flex flex-col">
          {sorted.map((scheduled) => (
            <ScheduledItem
              key={scheduled.id}
              scheduled={scheduled}
              onCancel={() => handleCancel(scheduled.id)}
              onSendNow={() => handleSendNow(scheduled.id)}
              onPause={() => handlePause(scheduled.id)}
              onResume={() => handleResume(scheduled.id)}
              onEdit={() => handleEdit(scheduled.id)}
            />
          ))}
        </div>
      )
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 items-center justify-between border-b px-4 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <SidebarToggle location="page" />
          <Link
            to={`/w/${workspaceId}`}
            className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8 shrink-0")}
            aria-label="Back to workspace"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex items-center gap-2 min-w-0">
            <Clock className="h-5 w-5 text-muted-foreground shrink-0" />
            <h1 className="font-semibold truncate">Scheduled</h1>
          </div>
        </div>
      </header>

      <ScrollArea className="flex-1 [&>div>div]:!block [&>div>div]:!w-full">
        <main className="py-1">{content}</main>
      </ScrollArea>
    </div>
  )
}

function ScheduledPageInner({ workspaceId }: { workspaceId: string }) {
  const items = useScheduledList(workspaceId)
  const cancelMutation = useCancelScheduled(workspaceId)
  const updateMutation = useUpdateScheduled(workspaceId)
  const pauseMutation = usePauseScheduled(workspaceId)
  const resumeMutation = useResumeScheduled(workspaceId)

  const handleCancel = (scheduledId: string) => {
    cancelMutation.mutate(scheduledId, {
      onSuccess: () => toast.success("Scheduled message cancelled"),
      onError: () => toast.error("Could not cancel scheduled message"),
    })
  }

  const handleSendNow = (scheduledId: string) => {
    updateMutation.mutate(
      { id: scheduledId, input: { scheduledAt: new Date().toISOString() } },
      {
        onSuccess: () => toast.success("Message sent"),
        onError: () => toast.error("Could not send message"),
      }
    )
  }

  const handlePause = (scheduledId: string) => {
    pauseMutation.mutate(scheduledId, {
      onSuccess: () => toast.success("Message paused"),
      onError: () => toast.error("Could not pause message"),
    })
  }

  const handleResume = (scheduledId: string) => {
    resumeMutation.mutate(scheduledId, {
      onSuccess: () => toast.success("Message resumed"),
      onError: () => toast.error("Could not resume message"),
    })
  }

  let content = <ScheduledSkeleton />
  if (items !== undefined) {
    if (items.length === 0) {
      content = <ScheduledEmpty />
    } else {
      content = (
        <div className="flex flex-col">
          {items.map((scheduled) => (
            <ScheduledItem
              key={scheduled.id}
              scheduled={scheduled}
              onCancel={() => handleCancel(scheduled.id)}
              onSendNow={() => handleSendNow(scheduled.id)}
              onPause={!scheduled.sentAt && !scheduled.cancelledAt ? () => handlePause(scheduled.id) : undefined}
              onResume={!scheduled.sentAt && !scheduled.cancelledAt ? () => handleResume(scheduled.id) : undefined}
            />
          ))}
        </div>
      )
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 items-center justify-between border-b px-4 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <SidebarToggle location="page" />
          <Link
            to={`/w/${workspaceId}`}
            className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8 shrink-0")}
            aria-label="Back to workspace"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex items-center gap-2 min-w-0">
            <Clock className="h-5 w-5 text-muted-foreground shrink-0" />
            <h1 className="font-semibold truncate">Scheduled</h1>
          </div>
        </div>
      </header>

      <ScrollArea className="flex-1 [&>div>div]:!block [&>div>div]:!w-full">
        <main className="py-1">{content}</main>
      </ScrollArea>
    </div>
  )
}
