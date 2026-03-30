import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { botsApi } from "@/api/bots"
import { StreamTypes, type WorkspaceBootstrap } from "@threa/types"
import { workspaceKeys } from "@/hooks/use-workspaces"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Hash, X } from "lucide-react"

interface BotChannelsSectionProps {
  workspaceId: string
  botId: string
  isArchived: boolean
}

export function BotChannelsSection({ workspaceId, botId, isArchived }: BotChannelsSectionProps) {
  const queryClient = useQueryClient()
  const [channelSearch, setChannelSearch] = useState("")

  const grantsQueryKey = ["bot-stream-grants", workspaceId, botId]
  const { data: streamGrants = [] } = useQuery({
    queryKey: grantsQueryKey,
    queryFn: () => botsApi.listStreamGrants(workspaceId, botId),
  })

  const { data: wsBootstrap } = useQuery({
    queryKey: workspaceKeys.bootstrap(workspaceId),
    queryFn: () => queryClient.getQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId)) ?? null,
    enabled: false,
    staleTime: Infinity,
  })

  const grantStreamMutation = useMutation({
    mutationFn: (streamId: string) => botsApi.grantStreamAccess(workspaceId, botId, streamId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: grantsQueryKey })
      setChannelSearch("")
    },
  })

  const revokeStreamMutation = useMutation({
    mutationFn: (streamId: string) => botsApi.revokeStreamAccess(workspaceId, botId, streamId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: grantsQueryKey }),
  })

  const grantedStreamIds = useMemo(() => new Set(streamGrants.map((g) => g.streamId)), [streamGrants])

  const availableChannels = useMemo(() => {
    if (!channelSearch || !wsBootstrap?.streams) return []
    const q = channelSearch.toLowerCase()
    return wsBootstrap.streams
      .filter(
        (s) =>
          s.type === StreamTypes.CHANNEL &&
          !s.archivedAt &&
          !grantedStreamIds.has(s.id) &&
          (s.slug?.toLowerCase().includes(q) || s.displayName?.toLowerCase().includes(q))
      )
      .slice(0, 10)
  }, [wsBootstrap, channelSearch, grantedStreamIds])

  const grantedStreams = useMemo(() => {
    if (!wsBootstrap?.streams) return []
    return streamGrants
      .map((g) => {
        const stream = wsBootstrap.streams.find((s) => s.id === g.streamId)
        return stream ? { ...g, slug: stream.slug, displayName: stream.displayName } : null
      })
      .filter(Boolean) as Array<{
      streamId: string
      grantedBy: string
      grantedAt: string
      slug: string | null
      displayName: string | null
    }>
  }, [streamGrants, wsBootstrap])

  return (
    <section className="space-y-3">
      <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Channel Access</h4>

      <p className="text-xs text-muted-foreground">
        Bots can access all public channels. Grant access to specific private channels below.
      </p>

      {grantedStreams.length > 0 && (
        <div className="rounded-md border divide-y">
          {grantedStreams.map((grant) => (
            <div key={grant.streamId} className="flex items-center justify-between px-3 py-2 group">
              <div className="flex items-center gap-2 min-w-0">
                <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm truncate">{grant.slug ?? grant.displayName ?? grant.streamId}</span>
              </div>
              {!isArchived && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity shrink-0"
                  onClick={() => revokeStreamMutation.mutate(grant.streamId)}
                  disabled={revokeStreamMutation.isPending}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {grantedStreams.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No private channel access granted.</p>
      )}

      {!isArchived && (
        <div className="space-y-1.5">
          <Input
            placeholder="Search channels to grant access..."
            value={channelSearch}
            onChange={(e) => setChannelSearch(e.target.value)}
            className="h-8"
          />
          {availableChannels.length > 0 && (
            <div className="rounded-md border divide-y max-h-40 overflow-y-auto">
              {availableChannels.map((stream) => (
                <button
                  key={stream.id}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors text-left"
                  onClick={() => grantStreamMutation.mutate(stream.id)}
                >
                  <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm truncate">{stream.slug ?? stream.displayName}</span>
                  <Badge variant="outline" className="ml-auto text-[10px] shrink-0">
                    {stream.visibility}
                  </Badge>
                </button>
              ))}
            </div>
          )}
          {channelSearch && availableChannels.length === 0 && (
            <p className="text-xs text-muted-foreground py-1">No matching channels</p>
          )}
        </div>
      )}
    </section>
  )
}
