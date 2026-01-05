import { useState, useCallback, useMemo } from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import { FileText, Hash, MessageSquare, Trash2, FileEdit, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ItemList, type QuickSwitcherItem } from "@/components/quick-switcher"
import { useAllDrafts, type UnifiedDraft, type DraftType } from "@/hooks"

const TYPE_ICONS: Record<DraftType, React.ComponentType<{ className?: string }>> = {
  scratchpad: FileText,
  channel: Hash,
  dm: MessageSquare,
  thread: MessageSquare,
}

export function DraftsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const { drafts, deleteDraft } = useAllDrafts(workspaceId ?? "")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [draftToDelete, setDraftToDelete] = useState<UnifiedDraft | null>(null)

  const handleSelectDraft = useCallback(
    (href: string | null) => {
      if (href) {
        navigate(href)
      }
    },
    [navigate]
  )

  const handleDeleteClick = useCallback((draft: UnifiedDraft) => {
    setDraftToDelete(draft)
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (draftToDelete) {
      const idToDelete = draftToDelete.id
      setDraftToDelete(null)
      await deleteDraft(idToDelete)
    }
  }, [draftToDelete, deleteDraft])

  const handleCancelDelete = useCallback(() => {
    setDraftToDelete(null)
  }, [])

  // Convert drafts to QuickSwitcherItem format
  const items: QuickSwitcherItem[] = useMemo(() => {
    return drafts.map((draft) => {
      let description = draft.preview
      if (draft.attachmentCount > 0) {
        const attachmentSuffix = ` [${draft.attachmentCount} 📎]`
        description = description ? `${description}${attachmentSuffix}` : attachmentSuffix
      }

      return {
        id: draft.id,
        label: draft.displayName,
        description,
        icon: TYPE_ICONS[draft.type],
        href: draft.href ?? undefined,
        onSelect: () => handleSelectDraft(draft.href),
        onAction: () => handleDeleteClick(draft),
        actionIcon: Trash2,
        actionLabel: "Delete draft",
      }
    })
  }, [drafts, handleSelectDraft, handleDeleteClick])

  // Handle item selection (navigate or open in new tab)
  const handleSelectItem = useCallback((item: QuickSwitcherItem, withModifier: boolean) => {
    if (withModifier && item.href) {
      window.open(item.href, "_blank")
    } else {
      item.onSelect()
    }
  }, [])

  if (!workspaceId) {
    return null
  }

  return (
    <>
      <div className="flex h-full flex-col">
        <header className="flex h-14 items-center gap-3 border-b px-4">
          <Link to={`/w/${workspaceId}`}>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <FileEdit className="h-5 w-5 text-muted-foreground" />
            <h1 className="font-semibold">Drafts</h1>
          </div>
        </header>
        <main
          className="flex-1 overflow-hidden"
          onKeyDown={(e) => {
            if (drafts.length === 0) return

            const isMod = e.metaKey || e.ctrlKey

            switch (e.key) {
              case "ArrowDown":
                e.preventDefault()
                setSelectedIndex((prev) => Math.min(prev + 1, drafts.length - 1))
                break
              case "ArrowUp":
                e.preventDefault()
                setSelectedIndex((prev) => Math.max(prev - 1, 0))
                break
              case "Enter": {
                e.preventDefault()
                const item = items[selectedIndex]
                if (item) {
                  handleSelectItem(item, isMod)
                }
                break
              }
            }
          }}
          tabIndex={0}
        >
          <ItemList
            items={items}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            onSelectItem={handleSelectItem}
            emptyMessage="No drafts"
          />
        </main>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!draftToDelete} onOpenChange={(open) => !open && handleCancelDelete()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The draft will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
