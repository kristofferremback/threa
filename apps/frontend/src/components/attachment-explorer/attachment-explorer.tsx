import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogTitle } from "@/components/ui/responsive-dialog"
import { useExplorerUrlState } from "./use-explorer-url-state"
import { ExplorerShell } from "./explorer-shell"

interface AttachmentExplorerProps {
  workspaceId: string
}

export function AttachmentExplorer({ workspaceId }: AttachmentExplorerProps) {
  const { isOpen, close } = useExplorerUrlState()

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={(open) => (open ? null : close())}>
      <ResponsiveDialogContent
        desktopClassName="overflow-hidden p-0 gap-0 shadow-lg sm:!fixed sm:!top-[12%] sm:!translate-y-0 sm:max-w-[920px] sm:rounded-2xl sm:!h-[76vh]"
        drawerClassName="overflow-hidden p-0 h-[92dvh]"
        hideCloseButton
      >
        <ResponsiveDialogTitle className="sr-only">Files</ResponsiveDialogTitle>
        <ExplorerShell workspaceId={workspaceId} mode="modal" enabled={isOpen} />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
