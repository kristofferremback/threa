import { useState, useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
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
import { X, UserPlus } from "lucide-react"
import { useAddStreamMember, useRemoveStreamMember, streamKeys, workspaceKeys } from "@/hooks"
import { useStreamService } from "@/contexts"
import { StreamTypes, type StreamMember, type WorkspaceBootstrap } from "@threa/types"
import { toast } from "sonner"

interface MembersTabProps {
  workspaceId: string
  streamId: string
  currentMemberId: string
}

export function MembersTab({ workspaceId, streamId, currentMemberId }: MembersTabProps) {
  const queryClient = useQueryClient()
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
  // Workspace bootstrap is always cached — cache-only observer
  const { data: wsBootstrap } = useQuery({
    queryKey: workspaceKeys.bootstrap(workspaceId),
    queryFn: () => queryClient.getQueryData<WorkspaceBootstrap>(workspaceKeys.bootstrap(workspaceId)) ?? null,
    enabled: false,
    staleTime: Infinity,
  })

  const streamType = bootstrap?.stream?.type
  const canAddMembers = streamType === StreamTypes.CHANNEL || streamType === StreamTypes.THREAD
  const streamMembers = bootstrap?.members ?? []
  const workspaceMembers = wsBootstrap?.members ?? []
  const currentWorkspaceMember = workspaceMembers.find((m) => m.id === currentMemberId)
  const canManageMembers = currentWorkspaceMember?.role === "owner" || currentWorkspaceMember?.role === "admin"

  const streamMemberIds = useMemo(() => new Set(streamMembers.map((m) => m.memberId)), [streamMembers])

  const enrichedMembers = useMemo(() => {
    return streamMembers
      .map((sm) => {
        const wm = workspaceMembers.find((m) => m.id === sm.memberId)
        return wm ? { ...sm, name: wm.name, slug: wm.slug, role: wm.role } : null
      })
      .filter(Boolean) as (StreamMember & { name: string; slug: string; role: string })[]
  }, [streamMembers, workspaceMembers])

  const filteredMembers = useMemo(() => {
    if (!search) return enrichedMembers
    const q = search.toLowerCase()
    return enrichedMembers.filter((m) => m.name.toLowerCase().includes(q) || m.slug.toLowerCase().includes(q))
  }, [enrichedMembers, search])

  const availableToAdd = useMemo(() => {
    if (!addSearch) return []
    const q = addSearch.toLowerCase()
    return workspaceMembers.filter(
      (m) => !streamMemberIds.has(m.id) && (m.name.toLowerCase().includes(q) || m.slug.toLowerCase().includes(q))
    )
  }, [workspaceMembers, streamMemberIds, addSearch])

  const handleAdd = (memberId: string) => {
    addMutation.mutate(memberId, {
      onSuccess: () => {
        toast.success("Member added")
        setAddSearch("")
      },
      onError: () => toast.error("Failed to add member"),
    })
  }

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
          {filteredMembers.map((member) => (
            <div key={member.memberId} className="flex items-center justify-between rounded-md border px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-medium truncate">{member.name || member.slug}</span>
                <span className="text-xs text-muted-foreground">@{member.slug}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant={member.role === "owner" ? "default" : "secondary"} className="text-xs">
                  {member.role}
                </Badge>
                {canManageMembers && member.memberId !== currentMemberId && (
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
          ))}
          {filteredMembers.length === 0 && <p className="text-sm text-muted-foreground py-2">No members found</p>}
        </div>
      </div>

      {canAddMembers && (
        <div className="space-y-3">
          <Label className="text-sm font-medium">Add member</Label>
          <div className="relative">
            <UserPlus className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search workspace members..."
              value={addSearch}
              onChange={(e) => setAddSearch(e.target.value)}
              className="h-8 pl-8"
            />
          </div>

          {availableToAdd.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto border rounded-md">
              {availableToAdd.map((member) => (
                <button
                  key={member.id}
                  className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                  onClick={() => handleAdd(member.id)}
                  disabled={addMutation.isPending}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">{member.name || member.slug}</span>
                    <span className="text-xs text-muted-foreground">@{member.slug}</span>
                  </div>
                  <Badge variant="outline" className="text-xs shrink-0">
                    Add
                  </Badge>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <AlertDialog open={removeMemberId !== null} onOpenChange={(open) => !open && setRemoveMemberId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {removeMemberName} from this stream?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemove}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
