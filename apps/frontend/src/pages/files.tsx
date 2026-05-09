import { ArrowLeft, Paperclip } from "lucide-react"
import { Link, useParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { SidebarToggle } from "@/components/layout"
import { ExplorerShell } from "@/components/attachment-explorer/explorer-shell"

export function FilesPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  if (!workspaceId) return null

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 items-center gap-2 border-b px-4">
        <SidebarToggle location="page" />
        <Link to={`/w/${workspaceId}`}>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <Paperclip className="h-5 w-5 text-muted-foreground" />
          <h1 className="font-semibold">Files</h1>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <ExplorerShell workspaceId={workspaceId} mode="page" enabled />
      </main>
    </div>
  )
}
