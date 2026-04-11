import { useRef } from "react"
import {
  ResponsiveAlertDialog,
  ResponsiveAlertDialogAction,
  ResponsiveAlertDialogCancel,
  ResponsiveAlertDialogContent,
  ResponsiveAlertDialogDescription,
  ResponsiveAlertDialogFooter,
  ResponsiveAlertDialogHeader,
  ResponsiveAlertDialogTitle,
} from "@/components/ui/responsive-alert-dialog"

interface DeleteMessageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  isDeleting: boolean
}

export function DeleteMessageDialog({ open, onOpenChange, onConfirm, isDeleting }: DeleteMessageDialogProps) {
  // Message deletion is a power-user flow (triggered by clearing an edit), so we
  // focus Delete instead of the Radix default Cancel to let Enter confirm immediately.
  const deleteButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <ResponsiveAlertDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveAlertDialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          deleteButtonRef.current?.focus()
        }}
      >
        <ResponsiveAlertDialogHeader>
          <ResponsiveAlertDialogTitle>Delete message</ResponsiveAlertDialogTitle>
          <ResponsiveAlertDialogDescription>
            Are you sure you want to delete this message? This action cannot be undone.
          </ResponsiveAlertDialogDescription>
        </ResponsiveAlertDialogHeader>
        <ResponsiveAlertDialogFooter>
          <ResponsiveAlertDialogCancel disabled={isDeleting}>Cancel</ResponsiveAlertDialogCancel>
          <ResponsiveAlertDialogAction
            ref={deleteButtonRef}
            onClick={onConfirm}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </ResponsiveAlertDialogAction>
        </ResponsiveAlertDialogFooter>
      </ResponsiveAlertDialogContent>
    </ResponsiveAlertDialog>
  )
}
