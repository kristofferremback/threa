import { Link, useParams } from "react-router-dom"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useWorkspaceBootstrap } from "@/hooks"
import { StreamTypes } from "@/types/domain"

interface SidebarProps {
  workspaceId: string
}

export function Sidebar({ workspaceId }: SidebarProps) {
  const { streamId: activeStreamId } = useParams<{ streamId: string }>()
  const { data: bootstrap, isLoading, error } = useWorkspaceBootstrap(workspaceId)

  const streams = bootstrap?.streams ?? []
  const scratchpads = streams.filter((s) => s.type === StreamTypes.SCRATCHPAD)
  const channels = streams.filter((s) => s.type === StreamTypes.CHANNEL)

  return (
    <div className="flex h-full flex-col">
      {/* Workspace header */}
      <div className="flex h-14 items-center border-b px-4">
        <Link to="/workspaces" className="font-semibold hover:underline truncate">
          {bootstrap?.workspace.name ?? "Loading..."}
        </Link>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {isLoading ? (
            <p className="px-2 py-4 text-xs text-muted-foreground text-center">Loading...</p>
          ) : error ? (
            <p className="px-2 py-4 text-xs text-destructive text-center">Failed to load</p>
          ) : (
            <>
              {/* Scratchpads section - primary for solo users */}
              <SidebarSection title="Scratchpads">
                {scratchpads.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-muted-foreground">No scratchpads yet</p>
                ) : (
                  scratchpads.map((stream) => (
                    <StreamItem
                      key={stream.id}
                      workspaceId={workspaceId}
                      streamId={stream.id}
                      name={stream.displayName || "Untitled"}
                      isActive={stream.id === activeStreamId}
                    />
                  ))
                )}
                <Button variant="ghost" size="sm" className="mt-1 w-full justify-start text-xs">
                  + New Scratchpad
                </Button>
              </SidebarSection>

              <Separator className="my-2" />

              {/* Channels section */}
              <SidebarSection title="Channels">
                {channels.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-muted-foreground">No channels yet</p>
                ) : (
                  channels.map((stream) => (
                    <StreamItem
                      key={stream.id}
                      workspaceId={workspaceId}
                      streamId={stream.id}
                      name={stream.slug ? `#${stream.slug}` : stream.displayName || "Untitled"}
                      isActive={stream.id === activeStreamId}
                    />
                  ))
                )}
                <Button variant="ghost" size="sm" className="mt-1 w-full justify-start text-xs">
                  + New Channel
                </Button>
              </SidebarSection>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <h3 className="mb-1 px-2 text-xs font-medium uppercase text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}

interface StreamItemProps {
  workspaceId: string
  streamId: string
  name: string
  isActive: boolean
}

function StreamItem({ workspaceId, streamId, name, isActive }: StreamItemProps) {
  return (
    <Link
      to={`/w/${workspaceId}/s/${streamId}`}
      className={cn(
        "block rounded-md px-2 py-1.5 text-sm transition-colors",
        isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
      )}
    >
      {name}
    </Link>
  )
}
