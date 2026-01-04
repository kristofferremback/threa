import { useState, useCallback, useMemo, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { FileText, Hash, MessageSquare, Trash2, FileEdit } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
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

interface DraftsModalProps {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DraftsModal({ workspaceId, open, onOpenChange }: DraftsModalProps) {
  const navigate = useNavigate()
  const { drafts, deleteDraft } = useAllDrafts(workspaceId)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [draftToDelete, setDraftToDelete] = useState<UnifiedDraft | null>(null)

  const handleClose = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const handleSelectDraft = useCallback(
    (href: string | null) => {
      if (href) {
        navigate(href)
      }
      handleClose()
    },
    [navigate, handleClose]
  )

  const handleDeleteClick = useCallback((draft: UnifiedDraft) => {
    setDraftToDelete(draft)
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (draftToDelete) {
      // Capture the ID before clearing state (onOpenChange may fire first)
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
      // Build description with preview and attachment count
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

  // Reset selection when drafts change
  useEffect(() => {
    setSelectedIndex(0)
  }, [drafts.length])

  // Reset selection when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedIndex(0)
    }
  }, [open])

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-lg p-0 gap-0"
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
              case "Enter":
                e.preventDefault()
                const item = items[selectedIndex]
                if (item) {
                  handleSelectItem(item, isMod)
                }
                break
            }
          }}
        >
          <DialogHeader className="px-4 py-3 border-b">
            <div className="flex items-center gap-2">
              <FileEdit className="h-5 w-5 text-muted-foreground" />
              <DialogTitle>Drafts</DialogTitle>
            </div>
            <DialogDescription className="sr-only">Your unsent message drafts</DialogDescription>
          </DialogHeader>

          <ItemList
            items={items}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            onSelectItem={handleSelectItem}
            emptyMessage="No drafts"
            itemTestId="draft-item"
          />
        </DialogContent>
      </Dialog>

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
            <AlertDialogAction data-testid="confirm-delete" onClick={handleConfirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
