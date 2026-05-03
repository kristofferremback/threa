import { useState } from "react"
import { Link, Navigate, useParams } from "react-router-dom"
import { ArrowLeft, CalendarClock } from "lucide-react"
import { toast } from "sonner"
import type { ScheduledMessageView } from "@threa/types"
import { buttonVariants } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { useScheduledList, useCancelScheduled, useSendScheduledNow } from "@/hooks"
import { ScheduledEmpty } from "@/components/scheduled/scheduled-empty"
import { ScheduledItem } from "@/components/scheduled/scheduled-item"
import { ScheduledSkeleton } from "@/components/scheduled/scheduled-skeleton"
import { ScheduledEditDialog } from "@/components/scheduled/scheduled-edit-dialog"
import { SidebarToggle } from "@/components/layout"

type PageTabValue = "pending" | "sent"
const TABS: { value: PageTabValue; label: string }[] = [
  { value: "pending", label: "To send" },
  { value: "sent", label: "Sent" },
]

const VALID_TABS = new Set<string>(["pending", "sent"])

/**
 * Routes:
 *   `/w/:wsId/scheduled` — To send tab (default)
 *   `/w/:wsId/scheduled/sent` — Sent tab
 *
 * URL-driven tabs per INV-59 — refreshes, back/forward, and shared links land
 * on the same view. Unknown segments redirect to the default.
 */
export function ScheduledPage() {
  const { workspaceId, tab: tabParam } = useParams<{ workspaceId: string; tab?: string }>()

  if (!workspaceId) return null

  if (tabParam === "pending") {
    return <Navigate to={`/w/${workspaceId}/scheduled`} replace />
  }
  if (tabParam !== undefined && !VALID_TABS.has(tabParam)) {
    return <Navigate to={`/w/${workspaceId}/scheduled`} replace />
  }

  const tab: PageTabValue = (tabParam as PageTabValue | undefined) ?? "pending"

  return <ScheduledPageInner workspaceId={workspaceId} tab={tab} />
}

interface InnerProps {
  workspaceId: string
  tab: PageTabValue
}

function ScheduledPageInner({ workspaceId, tab }: InnerProps) {
  const { items, isLoading } = useScheduledList(workspaceId, tab)
  const cancelMutation = useCancelScheduled(workspaceId)
  const sendNowMutation = useSendScheduledNow(workspaceId)
  const [editing, setEditing] = useState<ScheduledMessageView | null>(null)

  const handleCancel = (id: string) => {
    cancelMutation.mutate(id, {
      onSuccess: () => toast.success("Scheduled message cancelled"),
      onError: (err: Error) => toast.error(err.message ?? "Could not cancel"),
    })
  }

  const handleSendNow = (id: string) => {
    sendNowMutation.mutate(id, {
      onSuccess: () => toast.success("Sent"),
      onError: (err: Error) => toast.error(err.message ?? "Could not send"),
    })
  }

  const handleEdit = (id: string) => {
    const found = items.find((item) => item.id === id)
    if (found) setEditing(found)
  }

  let content = <ScheduledSkeleton />
  if (!isLoading) {
    if (items.length === 0) {
      content = <ScheduledEmpty status={tab} />
    } else {
      content = (
        <div className="flex flex-col">
          {items.map((scheduled) => (
            <ScheduledItem
              key={scheduled.id}
              scheduled={scheduled}
              workspaceId={workspaceId}
              onEdit={tab === "pending" ? handleEdit : undefined}
              onCancel={tab === "pending" ? handleCancel : undefined}
              onSendNow={tab === "pending" ? handleSendNow : undefined}
            />
          ))}
        </div>
      )
    }
  }

  const tabHref = (next: PageTabValue) =>
    next === "pending" ? `/w/${workspaceId}/scheduled` : `/w/${workspaceId}/scheduled/${next}`

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
            <CalendarClock className="h-5 w-5 text-muted-foreground shrink-0" />
            <h1 className="font-semibold truncate">Scheduled</h1>
          </div>
        </div>

        <Tabs value={tab}>
          <TabsList className="h-8">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} asChild>
                <Link to={tabHref(t.value)} className="text-xs px-2.5 py-1">
                  {t.label}
                </Link>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </header>

      <ScrollArea className="flex-1 [&>div>div]:!block [&>div>div]:!w-full">
        <main className="py-1">{content}</main>
      </ScrollArea>

      <ScheduledEditDialog workspaceId={workspaceId} scheduled={editing} onClose={() => setEditing(null)} />
    </div>
  )
}
