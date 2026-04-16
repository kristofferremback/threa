import { useState } from "react"
import { useParams, Link } from "react-router-dom"
import { ArrowLeft, Bookmark } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useSavedList, useUpdateSaved, useDeleteSaved } from "@/hooks"
import { SavedItem } from "@/components/saved/saved-item"
import { SavedEmpty } from "@/components/saved/saved-empty"
import { SavedSkeleton } from "@/components/saved/saved-skeleton"
import type { SavedStatus } from "@threa/types"

const TABS: { value: SavedStatus; label: string }[] = [
  { value: "saved", label: "Saved" },
  { value: "done", label: "Done" },
  { value: "archived", label: "Archived" },
]

export function SavedPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [tab, setTab] = useState<SavedStatus>("saved")

  if (!workspaceId) return null

  return <SavedPageInner workspaceId={workspaceId} tab={tab} onTabChange={setTab} />
}

interface InnerProps {
  workspaceId: string
  tab: SavedStatus
  onTabChange: (tab: SavedStatus) => void
}

function SavedPageInner({ workspaceId, tab, onTabChange }: InnerProps) {
  const { items, isLoading } = useSavedList(workspaceId, tab)
  const updateMutation = useUpdateSaved(workspaceId)
  const deleteMutation = useDeleteSaved(workspaceId)

  const handleUpdate = (savedId: string, status: SavedStatus, successLabel: string) => {
    updateMutation.mutate(
      { savedId, input: { status } },
      {
        onSuccess: () => toast.success(successLabel),
        onError: () => toast.error("Could not update saved item"),
      }
    )
  }

  const handleDelete = (savedId: string) => {
    deleteMutation.mutate(savedId, {
      onSuccess: () => toast.success("Saved item removed"),
      onError: () => toast.error("Could not remove saved item"),
    })
  }

  let content = <SavedSkeleton />
  if (!isLoading) {
    if (items.length === 0) {
      content = <SavedEmpty status={tab} />
    } else {
      content = (
        <div className="flex flex-col">
          {items.map((saved) => (
            <SavedItem
              key={saved.id}
              saved={saved}
              workspaceId={workspaceId}
              onMarkDone={tab === "saved" ? () => handleUpdate(saved.id, "done", "Marked done") : undefined}
              onArchive={tab === "saved" ? () => handleUpdate(saved.id, "archived", "Archived") : undefined}
              onRestore={tab !== "saved" ? () => handleUpdate(saved.id, "saved", "Restored") : undefined}
              onDelete={() => handleDelete(saved.id)}
            />
          ))}
        </div>
      )
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 items-center justify-between border-b px-4 gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <Link to={`/w/${workspaceId}`}>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2 min-w-0">
            <Bookmark className="h-5 w-5 text-muted-foreground shrink-0" />
            <h1 className="font-semibold truncate">Saved</h1>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => onTabChange(v as SavedStatus)}>
          <TabsList className="h-8">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="text-xs px-2.5 py-1">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </header>

      <ScrollArea className="flex-1 [&>div>div]:!block [&>div>div]:!w-full">
        <main className="py-1">{content}</main>
      </ScrollArea>
    </div>
  )
}
