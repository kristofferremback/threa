import { useParams } from "react-router-dom"
import { useStreamBootstrap } from "@/hooks"
import { TimelineView } from "@/components/timeline"

export function StreamPage() {
  const { workspaceId, streamId } = useParams<{ workspaceId: string; streamId: string }>()
  const { data: bootstrap } = useStreamBootstrap(workspaceId!, streamId!)

  if (!workspaceId || !streamId) {
    return null
  }

  const streamName = bootstrap?.stream.displayName || bootstrap?.stream.slug || "Stream"

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 items-center border-b px-4">
        <h1 className="font-semibold">{streamName}</h1>
      </header>
      <main className="flex-1 overflow-hidden">
        <TimelineView />
      </main>
    </div>
  )
}
