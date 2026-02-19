import { useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { useStreamSettings, STREAM_SETTINGS_TABS, type StreamSettingsTab } from "./use-stream-settings"
import { GeneralTab } from "./general-tab"
import { CompanionTab } from "./companion-tab"
import { MembersTab } from "./members-tab"
import { streamKeys, workspaceKeys } from "@/hooks"
import {
  StreamTypes,
  type Stream,
  type StreamBootstrap,
  type NotificationLevel,
  type WorkspaceBootstrap,
} from "@threa/types"

const TAB_LABELS: Record<StreamSettingsTab, string> = {
  general: "General",
  companion: "Companion",
  members: "Members",
}

interface StreamSettingsDialogProps {
  workspaceId: string
}

export function StreamSettingsDialog({ workspaceId }: StreamSettingsDialogProps) {
  const { isOpen, activeTab, streamId, closeStreamSettings, setTab } = useStreamSettings()

  const queryClient = useQueryClient()

  // Cache-only observers: subscribe to bootstrap cache updates without triggering fetches
  const { data: bootstrap } = useQuery({
    queryKey: streamKeys.bootstrap(workspaceId, streamId ?? ""),
    queryFn: () => queryClient.getQueryData<StreamBootstrap>(streamKeys.bootstrap(workspaceId, streamId ?? "")) ?? null,
    enabled: false,
    staleTime: Infinity,
  })
  const { data: wsBootstrap } = useQuery({
    queryKey: workspaceKeys.bootstrap(workspaceId),
    queryFn: () => queryClient.getQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId)) ?? null,
    enabled: false,
    staleTime: Infinity,
  })

  // Get stream from bootstrap cache, fallback to workspace bootstrap
  const stream = streamId ? (bootstrap?.stream ?? null) : null
  const streamFromWs = streamId ? (wsBootstrap?.streams?.find((s) => s.id === streamId) ?? null) : null
  const resolvedStream: Stream | null = stream ?? streamFromWs

  const currentMembership = useMemo(() => {
    if (!wsBootstrap?.streamMemberships || !streamId) return null
    return wsBootstrap.streamMemberships.find((m) => m.streamId === streamId) ?? null
  }, [wsBootstrap, streamId])

  const currentMemberId = currentMembership?.memberId ?? null
  const currentNotificationLevel: NotificationLevel | null = currentMembership?.notificationLevel ?? null

  // Determine available tabs based on stream type
  const availableTabs: readonly StreamSettingsTab[] = useMemo(() => {
    if (!resolvedStream) return STREAM_SETTINGS_TABS
    switch (resolvedStream.type) {
      case StreamTypes.CHANNEL:
        return ["general", "companion", "members"]
      case StreamTypes.SCRATCHPAD:
        return ["general", "companion", "members"]
      case StreamTypes.DM:
        return ["members"]
      default:
        return ["general"]
    }
  }, [resolvedStream])

  // If active tab isn't available for this stream type, fall back
  const effectiveTab = (availableTabs as readonly string[]).includes(activeTab) ? activeTab : availableTabs[0]

  const streamName = resolvedStream
    ? resolvedStream.slug
      ? `#${resolvedStream.slug}`
      : (resolvedStream.displayName ?? "Stream")
    : "Stream"

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeStreamSettings()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{streamName} Settings</DialogTitle>
        </DialogHeader>

        {resolvedStream && streamId && currentMemberId ? (
          <Tabs value={effectiveTab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
            <TabsList
              className={cn(
                "grid w-full",
                availableTabs.length === 1 && "grid-cols-1",
                availableTabs.length === 2 && "grid-cols-2",
                availableTabs.length === 3 && "grid-cols-3"
              )}
            >
              {availableTabs.map((tab) => (
                <TabsTrigger key={tab} value={tab}>
                  {TAB_LABELS[tab]}
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="flex-1 overflow-y-auto mt-4 pr-2 scrollbar-thin">
              <TabsContent value="general" className="mt-0">
                <GeneralTab
                  workspaceId={workspaceId}
                  stream={resolvedStream}
                  currentMemberId={currentMemberId}
                  notificationLevel={currentNotificationLevel}
                />
              </TabsContent>
              <TabsContent value="companion" className="mt-0">
                <CompanionTab stream={resolvedStream} />
              </TabsContent>
              <TabsContent value="members" className="mt-0">
                <MembersTab workspaceId={workspaceId} streamId={streamId} currentMemberId={currentMemberId} />
              </TabsContent>
            </div>
          </Tabs>
        ) : (
          <p className="text-sm text-muted-foreground p-4">Loading stream settings...</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
