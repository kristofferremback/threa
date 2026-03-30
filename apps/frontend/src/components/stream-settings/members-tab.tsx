import { useState, useMemo, useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { SearchableList } from "@/components/ui/searchable-list"
import { renderUserListItem, type UserListItem } from "@/components/ui/user-list-item"
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
import { X, UserPlus, BotIcon } from "lucide-react"
import { useAddStreamMember, useRemoveStreamMember, streamKeys } from "@/hooks"
import { useStreamService } from "@/contexts"
import { botsApi } from "@/api/bots"
import { useWorkspaceUsers, useWorkspaceBots } from "@/stores/workspace-store"
import { StreamTypes, type StreamMember } from "@threa/types"
import { getInitials } from "@/lib/initials"
import { getAvatarColor } from "@/lib/avatar-color"
import { toast } from "sonner"

interface MembersTabProps {
  workspaceId: string
  streamId: string
  currentUserId: string
}

export function MembersTab({ workspaceId, streamId, currentUserId }: MembersTabProps) {
  const streamService = useStreamService()
  const [search, setSearch] = useState("")
  const [addSearch, setAddSearch] = useState("")
  const addMutation = useAddStreamMember(workspaceId, streamId)
  const removeMutation = useRemoveStreamMember(workspaceId, streamId)

  // Fetch stream bootstrap if not cached (e.g. settings opened from sidebar without viewing stream).
  // staleTime: Infinity so this observer never refetches existing data — useStreamBootstrap's
  // observer (staleTime: 0) will still re-run its queryFn (which includes socket room joining)
  // when the user navigates to the stream.
  const { data: bootstrap } = useQuery({
    queryKey: streamKeys.bootstrap(workspaceId, streamId),
    queryFn: () => streamService.bootstrap(workspaceId, streamId),
    staleTime: Infinity,
  })
  const workspaceUsers = useWorkspaceUsers(workspaceId)

  const streamType = bootstrap?.stream?.type
  const canAddMembers = streamType === StreamTypes.CHANNEL || streamType === StreamTypes.THREAD
  const streamMembers = bootstrap?.members ?? []
  const currentWorkspaceUser = workspaceUsers.find((u) => u.id === currentUserId)
  const canManageMembers = currentWorkspaceUser?.role === "owner" || currentWorkspaceUser?.role === "admin"

  const streamMemberIds = useMemo(() => new Set(streamMembers.map((m) => m.memberId)), [streamMembers])

  const enrichedMembers = useMemo(() => {
    return streamMembers
      .map((sm) => {
        const workspaceUser = workspaceUsers.find((u) => u.id === sm.memberId)
        return workspaceUser
          ? { ...sm, name: workspaceUser.name, slug: workspaceUser.slug, role: workspaceUser.role }
          : null
      })
      .filter(Boolean) as (StreamMember & { name: string; slug: string; role: string })[]
  }, [streamMembers, workspaceUsers])

  const filteredMembers = useMemo(() => {
    if (!search) return enrichedMembers
    const q = search.toLowerCase()
    return enrichedMembers.filter((m) => m.name.toLowerCase().includes(q) || m.slug.toLowerCase().includes(q))
  }, [enrichedMembers, search])

  const availableToAdd = useMemo((): UserListItem[] => {
    if (!addSearch) return []
    const q = addSearch.toLowerCase()
    return workspaceUsers
      .filter(
        (m) => !streamMemberIds.has(m.id) && (m.name.toLowerCase().includes(q) || m.slug.toLowerCase().includes(q))
      )
      .map((m) => ({
        id: m.id,
        label: m.name || m.slug,
        description: `@${m.slug}`,
        slug: m.slug,
        name: m.name,
      }))
  }, [workspaceUsers, streamMemberIds, addSearch])

  const handleAdd = useCallback(
    (item: UserListItem) => {
      addMutation.mutate(item.id, {
        onSuccess: () => {
          toast.success("Member added")
          setAddSearch("")
        },
        onError: () => toast.error("Failed to add member"),
      })
    },
    [addMutation]
  )

  const [removeMemberId, setRemoveMemberId] = useState<string | null>(null)
  const removeMemberName = removeMemberId
    ? (enrichedMembers.find((m) => m.memberId === removeMemberId)?.name ?? removeMemberId)
    : null

  const handleRemove = () => {
    if (!removeMemberId) return
    removeMutation.mutate(removeMemberId, {
      onSuccess: () => toast.success("Member removed"),
      onError: () => toast.error("Failed to remove member"),
    })
    setRemoveMemberId(null)
  }

  return (
    <div className="space-y-6 p-1">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Members ({enrichedMembers.length})</Label>
        </div>

        <Input
          placeholder="Filter members..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8"
        />

        <div className="space-y-1 max-h-64 overflow-y-auto">
          {filteredMembers.map((member) => {
            const initials = getInitials(member.name || member.slug)
            const color = getAvatarColor(member.memberId)

            return (
              <div key={member.memberId} className="flex items-center justify-between rounded-md border px-3 py-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`flex items-center justify-center h-7 w-7 rounded-full text-xs font-medium shrink-0 ${color}`}
                  >
                    {initials}
                  </div>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-sm font-medium truncate">{member.name || member.slug}</span>
                    <span className="text-xs text-muted-foreground">@{member.slug}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={member.role === "owner" ? "default" : "secondary"} className="text-xs">
                    {member.role}
                  </Badge>
                  {canManageMembers && member.memberId !== currentUserId && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setRemoveMemberId(member.memberId)}
                      disabled={removeMutation.isPending}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
          {filteredMembers.length === 0 && <p className="text-sm text-muted-foreground py-2">No members found</p>}
        </div>
      </div>

      {canAddMembers && (
        <div className="space-y-3">
          <Label className="text-sm font-medium">Add member</Label>
          <SearchableList
            items={availableToAdd}
            renderItem={renderUserListItem}
            onSelect={handleAdd}
            search={addSearch}
            onSearchChange={setAddSearch}
            placeholder="Search workspace users..."
            emptyMessage="No matching users"
            icon={UserPlus}
          />
        </div>
      )}

      {canManageMembers && streamType === StreamTypes.CHANNEL && (
        <>
          <Separator />
          <StreamBotsSection workspaceId={workspaceId} streamId={streamId} />
        </>
      )}

      <ResponsiveAlertDialog open={removeMemberId !== null} onOpenChange={(open) => !open && setRemoveMemberId(null)}>
        <ResponsiveAlertDialogContent>
          <ResponsiveAlertDialogHeader>
            <ResponsiveAlertDialogTitle>Remove member?</ResponsiveAlertDialogTitle>
            <ResponsiveAlertDialogDescription>
              Are you sure you want to remove {removeMemberName} from this stream?
            </ResponsiveAlertDialogDescription>
          </ResponsiveAlertDialogHeader>
          <ResponsiveAlertDialogFooter>
            <ResponsiveAlertDialogCancel>Cancel</ResponsiveAlertDialogCancel>
            <ResponsiveAlertDialogAction onClick={handleRemove}>Remove</ResponsiveAlertDialogAction>
          </ResponsiveAlertDialogFooter>
        </ResponsiveAlertDialogContent>
      </ResponsiveAlertDialog>
    </div>
  )
}

// ─── Stream Bots Section ────────────────────────────────────────────────────

function StreamBotsSection({ workspaceId, streamId }: { workspaceId: string; streamId: string }) {
  const queryClient = useQueryClient()
  const [botSearch, setBotSearch] = useState("")
  const allBots = useWorkspaceBots(workspaceId)

  // Single query: which bots have been granted access to this stream
  const streamBotsQueryKey = ["stream-bots", workspaceId, streamId]
  const { data: grantedBotIds = [] } = useQuery({
    queryKey: streamBotsQueryKey,
    queryFn: () => botsApi.listStreamBots(workspaceId, streamId),
  })

  const grantedBotIdSet = useMemo(() => new Set(grantedBotIds), [grantedBotIds])

  const botsWithAccess = useMemo(() => allBots.filter((b) => grantedBotIdSet.has(b.id)), [allBots, grantedBotIdSet])

  const availableToGrant = useMemo(() => {
    if (!botSearch) return []
    const q = botSearch.toLowerCase()
    return allBots
      .filter(
        (b) =>
          !b.archivedAt &&
          !grantedBotIdSet.has(b.id) &&
          (b.name.toLowerCase().includes(q) || b.slug?.toLowerCase().includes(q))
      )
      .slice(0, 10)
  }, [allBots, grantedBotIdSet, botSearch])

  const grantMutation = useMutation({
    mutationFn: (botId: string) => botsApi.grantStreamAccess(workspaceId, botId, streamId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: streamBotsQueryKey })
      setBotSearch("")
    },
  })

  const revokeMutation = useMutation({
    mutationFn: (botId: string) => botsApi.revokeStreamAccess(workspaceId, botId, streamId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: streamBotsQueryKey }),
  })

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Bots ({botsWithAccess.length})</Label>

      {botsWithAccess.length > 0 && (
        <div className="space-y-1">
          {botsWithAccess.map((bot) => (
            <div key={bot.id} className="flex items-center justify-between rounded-md border px-3 py-2 group">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex items-center justify-center h-7 w-7 rounded-full bg-emerald-500/10 text-emerald-600 text-xs font-medium shrink-0">
                  {bot.avatarEmoji ?? <BotIcon className="h-3.5 w-3.5" />}
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm font-medium truncate">{bot.name}</span>
                  {bot.slug && <span className="text-xs text-muted-foreground">@{bot.slug}</span>}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity shrink-0"
                onClick={() => revokeMutation.mutate(bot.id)}
                disabled={revokeMutation.isPending}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {botsWithAccess.length === 0 && allBots.length > 0 && (
        <p className="text-xs text-muted-foreground">No bots have been added to this channel.</p>
      )}

      {allBots.length === 0 && (
        <p className="text-xs text-muted-foreground">No bots in this workspace. Create one in workspace settings.</p>
      )}

      {allBots.length > 0 && (
        <div className="space-y-1.5">
          <Input
            placeholder="Search bots to add..."
            value={botSearch}
            onChange={(e) => setBotSearch(e.target.value)}
            className="h-8"
          />
          {availableToGrant.length > 0 && (
            <div className="rounded-md border divide-y max-h-40 overflow-y-auto">
              {availableToGrant.map((bot) => (
                <button
                  key={bot.id}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-accent/50 transition-colors text-left"
                  onClick={() => grantMutation.mutate(bot.id)}
                >
                  <div className="flex items-center justify-center h-6 w-6 rounded-full bg-emerald-500/10 text-emerald-600 text-xs shrink-0">
                    {bot.avatarEmoji ?? <BotIcon className="h-3 w-3" />}
                  </div>
                  <span className="text-sm truncate">{bot.name}</span>
                  {bot.slug && <span className="text-xs text-muted-foreground">@{bot.slug}</span>}
                </button>
              ))}
            </div>
          )}
          {botSearch && availableToGrant.length === 0 && (
            <p className="text-xs text-muted-foreground py-1">No matching bots</p>
          )}
        </div>
      )}
    </div>
  )
}
