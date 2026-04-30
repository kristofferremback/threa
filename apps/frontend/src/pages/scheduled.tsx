import { useParams, Link } from "react-router-dom"
import { ArrowLeft, Clock } from "lucide-react"
import { toast } from "sonner"
import { buttonVariants } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { useScheduledList, useCancelScheduled } from "@/hooks/use-scheduled"
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

  const handleCancel = (scheduledId: string) => {
    cancelMutation.mutate(scheduledId, {
      onSuccess: () => toast.success("Scheduled message cancelled"),
      onError: () => toast.error("Could not cancel scheduled message"),
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
            <ScheduledItem key={scheduled.id} scheduled={scheduled} onCancel={() => handleCancel(scheduled.id)} />
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
